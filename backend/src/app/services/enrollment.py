"""Enrolling employee faces and matching camera frames against them."""
from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from app.models import Camera, Employee, FaceTemplate, RecognitionEvent
from app.services import attendance as attendance_rules
from app.services.recognition import (
    Encoding,
    FaceError,
    Match,
    NoFaceDetected,
    get_engine,
)

logger = logging.getLogger(__name__)

_TEMPLATE_CACHE_KEY = 'face_templates:v1'


class EnrollmentError(Exception):
    pass


def enroll_face(employee: Employee, image, enrolled_by=None) -> FaceTemplate:
    """Create one face template for an employee from an uploaded photo.

    Raises `EnrollmentError` when the photo is unusable, so the caller can
    tell the operator exactly what to re-shoot.
    """
    engine = get_engine()
    try:
        encoding: Encoding = engine.encode(image)
    except FaceError as exc:
        raise EnrollmentError(str(exc)) from exc

    if encoding.quality < settings.FACE_MIN_ENROLL_QUALITY:
        raise EnrollmentError(
            f'Face is too small or unclear (quality {encoding.quality:.2f}, '
            f'minimum {settings.FACE_MIN_ENROLL_QUALITY}). Move closer to the camera.'
        )

    # Reject a photo that already matches a *different* employee: that is
    # either a mix-up at the desk or an attempt to register somebody twice.
    existing = _active_templates(engine.name)
    duplicate = engine.search(encoding.vector, existing)
    if duplicate and duplicate.employee_id != employee.id:
        other = Employee.objects.filter(id=duplicate.employee_id).first()
        raise EnrollmentError(
            f'This face is already enrolled for {other.employee_code if other else "another employee"}.'
        )

    template = FaceTemplate.objects.create(
        employee=employee,
        embedding=encoding.vector,
        engine=engine.name,
        dimensions=encoding.dimensions,
        quality_score=encoding.quality,
        source_image=image if hasattr(image, 'read') else None,
        enrolled_by=enrolled_by,
    )
    invalidate_template_cache()
    return template


def _active_templates(engine_name: str) -> list[tuple[int, int, list[float]]]:
    """All active templates for an engine, as (template_id, employee_id, vector).

    Cached because every camera frame needs the full set, and the set changes
    only on enrollment. For very large headcounts this is where a vector index
    (FAISS, pgvector) would replace the linear scan.
    """
    cached = cache.get(_TEMPLATE_CACHE_KEY)
    if cached is not None and cached.get('engine') == engine_name:
        return cached['rows']

    rows = list(
        FaceTemplate.objects.filter(
            is_active=True,
            engine=engine_name,
            employee__status__in=[Employee.Status.ACTIVE, Employee.Status.PROBATION],
        ).values_list('id', 'employee_id', 'embedding')
    )
    rows = [(tid, eid, vec) for tid, eid, vec in rows]
    cache.set(
        _TEMPLATE_CACHE_KEY,
        {'engine': engine_name, 'rows': rows},
        settings.FACE_TEMPLATE_CACHE_SECONDS,
    )
    return rows


def invalidate_template_cache() -> None:
    cache.delete(_TEMPLATE_CACHE_KEY)


@dataclass
class IngestResult:
    """Outcome of one submitted camera frame."""

    event: RecognitionEvent
    employee: Employee | None = None
    attendance_action: str = ''
    detail: str = ''
    #: Where this face was in the frame, for a client drawing an overlay.
    box: dict | None = None

    @property
    def recognized(self) -> bool:
        return self.employee is not None


def process_frame(
    camera: Camera,
    image,
    captured_at: dt.datetime | None = None,
    store_snapshot: bool = True,
) -> list[IngestResult]:
    """Recognize everybody in a frame and record their attendance.

    Always produces at least one `RecognitionEvent`, even on failure, so the
    door has a complete audit trail. Never raises for an unrecognizable
    frame -- a camera must not be able to crash the endpoint with a bad image.
    """
    captured_at = captured_at or timezone.now()
    engine = get_engine()
    camera.touch()

    snapshot = image if store_snapshot else None

    try:
        encoder = getattr(engine, 'encode_all', None)
        encodings = encoder(image) if encoder else [engine.encode(image)]
    except NoFaceDetected as exc:
        event = RecognitionEvent.objects.create(
            camera=camera, decision=RecognitionEvent.Decision.NO_FACE,
            captured_at=captured_at, snapshot=snapshot, message=str(exc)[:255],
        )
        return [IngestResult(event=event, detail=str(exc))]
    except FaceError as exc:
        event = RecognitionEvent.objects.create(
            camera=camera, decision=RecognitionEvent.Decision.ERROR,
            captured_at=captured_at, snapshot=snapshot, message=str(exc)[:255],
        )
        return [IngestResult(event=event, detail=str(exc))]
    except Exception as exc:  # noqa: BLE001 - a bad frame must not 500 the door
        logger.exception('Unexpected failure decoding a frame from %s', camera)
        event = RecognitionEvent.objects.create(
            camera=camera, decision=RecognitionEvent.Decision.ERROR,
            captured_at=captured_at, message=f'Internal error: {exc}'[:255],
        )
        return [IngestResult(event=event, detail='Internal error.')]

    candidates = _active_templates(engine.name)
    threshold = engine.match_threshold
    results: list[IngestResult] = []

    for encoding in encodings:
        match: Match | None = None
        try:
            match = engine.search(encoding.vector, candidates, threshold)
        except FaceError as exc:
            logger.warning('Search failed for %s: %s', camera, exc)

        if match is None:
            event = RecognitionEvent.objects.create(
                camera=camera, decision=RecognitionEvent.Decision.NO_MATCH,
                captured_at=captured_at, snapshot=snapshot,
                message='No enrolled employee within the matching threshold.',
            )
            results.append(
                IngestResult(event=event, detail=event.message, box=encoding.box)
            )
            continue

        if match.confidence < camera.min_confidence:
            event = RecognitionEvent.objects.create(
                camera=camera, employee_id=match.employee_id,
                matched_template_id=match.template_id,
                decision=RecognitionEvent.Decision.LOW_CONFIDENCE,
                confidence=match.confidence, distance=match.distance,
                captured_at=captured_at, snapshot=snapshot,
                message=(
                    f'Confidence {match.confidence:.2f} below the camera '
                    f'minimum {camera.min_confidence:.2f}.'
                ),
            )
            results.append(
                IngestResult(event=event, detail=event.message, box=encoding.box)
            )
            continue

        employee = Employee.objects.select_related('shift').get(id=match.employee_id)
        outcome = attendance_rules.register_sighting(employee, camera, captured_at)

        decision = (
            RecognitionEvent.Decision.DUPLICATE
            if outcome.action == 'duplicate'
            else RecognitionEvent.Decision.MATCHED
        )
        event = RecognitionEvent.objects.create(
            camera=camera, employee=employee,
            matched_template_id=match.template_id, decision=decision,
            confidence=match.confidence, distance=match.distance,
            captured_at=captured_at, snapshot=snapshot,
            message=outcome.detail[:255],
        )
        results.append(
            IngestResult(
                event=event, employee=employee,
                attendance_action=outcome.action, detail=outcome.detail,
                box=encoding.box,
            )
        )

    return results
