"""Face recognition engines.

The rest of the system talks to an engine only through `BaseEngine`, so the
underlying model can be swapped without touching views, models or attendance
rules. Templates record the engine that produced them and are only ever
compared against embeddings from that same engine -- descriptors from
different models live in different vector spaces and are not comparable.
"""
from __future__ import annotations

import hashlib
import io
import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
from django.conf import settings
from django.core.files.uploadedfile import UploadedFile

logger = logging.getLogger(__name__)


class FaceError(Exception):
    """Raised when an image cannot be turned into an embedding."""


class NoFaceDetected(FaceError):
    pass


class MultipleFacesDetected(FaceError):
    pass


@dataclass(frozen=True)
class Encoding:
    """An embedding plus the quality the engine assigned to the capture."""

    vector: list[float]
    quality: float
    #: Where the face sat in the frame, as fractions of width/height:
    #: {x, y, w, h} in 0..1. Fractions rather than pixels so a client can
    #: draw the box over a video element of any size. None when the engine
    #: does not report a position.
    box: dict | None = None

    @property
    def dimensions(self) -> int:
        return len(self.vector)


@dataclass(frozen=True)
class Match:
    template_id: int
    employee_id: int
    distance: float
    confidence: float


def _read_bytes(image) -> bytes:
    """Accept an upload, a file-like object or raw bytes."""
    if isinstance(image, (bytes, bytearray)):
        return bytes(image)
    if isinstance(image, UploadedFile) or hasattr(image, 'read'):
        pos = image.tell() if hasattr(image, 'tell') else None
        if pos is not None:
            image.seek(0)
        data = image.read()
        if pos is not None:
            image.seek(pos)
        return data
    raise FaceError('Unsupported image input.')


class BaseEngine:
    """Interface every recognition engine implements."""

    name: str = 'base'
    dimensions: int = 0
    #: Distance at or below which two embeddings are considered the same face.
    match_threshold: float = 0.6

    def encode(self, image) -> Encoding:
        """Turn one image into a single face embedding."""
        raise NotImplementedError

    def distance(self, a: np.ndarray, b: np.ndarray) -> np.ndarray:
        """Euclidean distance between one probe and a stack of candidates."""
        return np.linalg.norm(b - a, axis=1)

    def confidence(self, distance: float) -> float:
        """Map a distance onto 0..1, where 1 is a perfect match.

        Linear falloff over twice the threshold keeps the number easy to
        reason about for operators tuning a door camera.
        """
        span = self.match_threshold * 2
        return float(max(0.0, min(1.0, 1.0 - (distance / span))))

    def search(self, probe: list[float], candidates: list[tuple[int, int, list[float]]],
               threshold: float | None = None) -> Match | None:
        """Find the closest candidate within `threshold`.

        `candidates` is a list of (template_id, employee_id, vector).
        """
        if not candidates:
            return None
        limit = self.match_threshold if threshold is None else threshold
        probe_vec = np.asarray(probe, dtype=np.float64)
        matrix = np.asarray([c[2] for c in candidates], dtype=np.float64)
        if matrix.shape[1] != probe_vec.shape[0]:
            raise FaceError('Embedding dimensions do not match stored templates.')
        distances = self.distance(probe_vec, matrix)
        best = int(np.argmin(distances))
        best_distance = float(distances[best])
        if best_distance > limit:
            return None
        template_id, employee_id, _ = candidates[best]
        return Match(
            template_id=template_id,
            employee_id=employee_id,
            distance=best_distance,
            confidence=self.confidence(best_distance),
        )


class FaceRecognitionEngine(BaseEngine):
    """Real recognition backed by dlib's 128-d ResNet, via `face_recognition`.

    Active only when the library is importable; see `get_engine`.
    """

    name = 'dlib_resnet_v1'
    dimensions = 128
    match_threshold = 0.6

    def __init__(self):
        import face_recognition  # noqa: PLC0415 - optional dependency

        self._fr = face_recognition

    def encode(self, image) -> Encoding:
        data = _read_bytes(image)
        array = self._fr.load_image_file(io.BytesIO(data))
        boxes = self._fr.face_locations(array, model=settings.FACE_DETECTION_MODEL)
        if not boxes:
            raise NoFaceDetected('No face found in the image.')
        if len(boxes) > 1:
            raise MultipleFacesDetected(
                f'{len(boxes)} faces found; enrollment needs exactly one.'
            )
        encodings = self._fr.face_encodings(array, known_face_locations=boxes)
        if not encodings:
            raise NoFaceDetected('Face detected but no descriptor could be computed.')
        return Encoding(
            vector=[float(v) for v in encodings[0]],
            quality=self._quality(array, boxes[0]),
        )

    def encode_all(self, image) -> list[Encoding]:
        """Encode every face in a frame -- used for camera frames, where
        several people may walk through a door together."""
        data = _read_bytes(image)
        array = self._fr.load_image_file(io.BytesIO(data))
        boxes = self._fr.face_locations(array, model=settings.FACE_DETECTION_MODEL)
        if not boxes:
            raise NoFaceDetected('No face found in the frame.')
        encodings = self._fr.face_encodings(array, known_face_locations=boxes)
        return [
            Encoding(vector=[float(v) for v in enc], quality=self._quality(array, box))
            for enc, box in zip(encodings, boxes)
        ]

    @staticmethod
    def _quality(array, box) -> float:
        """Rough capture quality from how much of the frame the face fills.

        A face that is too small in frame produces a weak descriptor, so this
        gives enrollment something to reject on.
        """
        top, right, bottom, left = box
        face_area = max(1, (bottom - top) * (right - left))
        frame_area = max(1, array.shape[0] * array.shape[1])
        ratio = face_area / frame_area
        return float(max(0.0, min(1.0, ratio * 6)))


class OpenCVSFaceEngine(BaseEngine):
    """Real recognition using OpenCV's bundled YuNet + SFace models.

    Chosen over dlib because both ship as ONNX files and run on the
    `opencv-python` wheel: no compiler, no cmake, no dlib build. Accuracy is
    comparable for a door camera.

    SFace produces a 128-d embedding compared by cosine distance, so unlike
    the dlib engine the threshold is a *similarity*, not a euclidean radius.
    `distance()` returns `1 - cosine` to keep "smaller is closer" true for
    the shared `search()` in BaseEngine.
    """

    name = 'opencv_sface_v1'
    dimensions = 128
    #: 1 - cosine similarity. 0.363 similarity is OpenCV's recommended
    #: same-person threshold, so the distance form is 1 - 0.363.
    match_threshold = 0.637

    def __init__(self):
        import cv2  # noqa: PLC0415 - optional dependency

        self._cv2 = cv2
        base = Path(settings.BASE_DIR) / 'models'
        detector_path = base / 'face_detection_yunet_2023mar.onnx'
        recogniser_path = base / 'face_recognition_sface_2021dec.onnx'

        if not detector_path.exists() or not recogniser_path.exists():
            raise ImportError(
                f'Face models missing from {base}. See the README for the '
                'two ONNX files to download.'
            )

        self._detector = cv2.FaceDetectorYN.create(
            str(detector_path), '', (320, 320),
            settings.FACE_DETECT_CONFIDENCE, 0.3, 5000,
        )
        self._recogniser = cv2.FaceRecognizerSF.create(str(recogniser_path), '')

    def _decode(self, image):
        data = _read_bytes(image)
        array = np.frombuffer(data, dtype=np.uint8)
        frame = self._cv2.imdecode(array, self._cv2.IMREAD_COLOR)
        if frame is None:
            raise FaceError('Could not decode the image.')
        return frame

    def _detect(self, frame):
        height, width = frame.shape[:2]
        self._detector.setInputSize((width, height))
        _, faces = self._detector.detect(frame)
        return [] if faces is None else list(faces)

    def _embed(self, frame, face):
        aligned = self._recogniser.alignCrop(frame, face)
        feature = self._recogniser.feature(aligned)
        vector = np.asarray(feature, dtype=np.float64).flatten()
        # Normalising here means cosine distance is a plain dot product.
        norm = np.linalg.norm(vector) or 1.0
        return (vector / norm).tolist()

    @staticmethod
    def _quality(frame, face):
        """How much of the frame the face fills, as a rough capture score.

        A face too small in frame yields a weak embedding, which is what
        enrolment rejects on.
        """
        height, width = frame.shape[:2]
        face_area = max(1.0, float(face[2]) * float(face[3]))
        ratio = face_area / max(1.0, float(height * width))
        return float(max(0.0, min(1.0, ratio * 6)))

    @staticmethod
    def _box(frame, face):
        """The face rectangle as fractions of the frame, clamped to 0..1."""
        height, width = frame.shape[:2]
        x, y, w, h = (float(v) for v in face[:4])
        clamp = lambda v: float(max(0.0, min(1.0, v)))  # noqa: E731
        return {
            'x': clamp(x / width),
            'y': clamp(y / height),
            'w': clamp(w / width),
            'h': clamp(h / height),
        }

    def distance(self, a, b):
        """Cosine distance against a stack of candidates.

        Both sides are unit vectors, so the dot product is the cosine and
        `1 - cosine` gives a distance where smaller means more alike.
        """
        return 1.0 - (b @ a)

    def confidence(self, distance):
        """Map cosine distance onto 0..1 across the usable range."""
        similarity = 1.0 - distance
        # Below ~0.2 similarity the match is meaningless; 1.0 is identical.
        return float(max(0.0, min(1.0, (similarity - 0.2) / 0.8)))

    def encode(self, image):
        frame = self._decode(image)
        faces = self._detect(frame)
        if not faces:
            raise NoFaceDetected('No face found in the image.')
        if len(faces) > 1:
            raise MultipleFacesDetected(
                f'{len(faces)} faces found; enrolment needs exactly one.'
            )
        return Encoding(
            vector=self._embed(frame, faces[0]),
            quality=self._quality(frame, faces[0]),
            box=self._box(frame, faces[0]),
        )

    def encode_all(self, image):
        """Encode every face in a frame -- several people may walk in together."""
        frame = self._decode(image)
        faces = self._detect(frame)
        if not faces:
            raise NoFaceDetected('No face found in the frame.')
        return [
            Encoding(
                vector=self._embed(frame, face),
                quality=self._quality(frame, face),
                box=self._box(frame, face),
            )
            for face in faces
        ]


class HashEngine(BaseEngine):
    """Deterministic stand-in used when no real model is installed.

    It derives a stable vector from the image bytes, so the same image always
    matches itself and different images do not. That is enough to exercise
    enrollment, camera ingestion, attendance rules and the whole API surface
    end to end; it is NOT face recognition and must never run in production.
    `get_engine` refuses to select it when DEBUG is off.
    """

    name = 'hash_stub_v1'
    dimensions = 64
    match_threshold = 0.35

    def encode(self, image) -> Encoding:
        data = _read_bytes(image)
        if not data:
            raise NoFaceDetected('Empty image.')
        digest = hashlib.sha512(data).digest()
        # Stretch the digest to the full dimension count deterministically.
        raw = bytearray()
        counter = 0
        while len(raw) < self.dimensions:
            raw.extend(hashlib.sha512(digest + counter.to_bytes(4, 'big')).digest())
            counter += 1
        vector = np.frombuffer(bytes(raw[: self.dimensions]), dtype=np.uint8)
        vector = vector.astype(np.float64) / 255.0
        norm = np.linalg.norm(vector) or 1.0
        return Encoding(vector=(vector / norm).tolist(), quality=1.0)

    def encode_all(self, image) -> list[Encoding]:
        return [self.encode(image)]


@lru_cache(maxsize=1)
def get_engine() -> BaseEngine:
    """Return the configured engine, falling back to the stub in development.

    Cached because loading a real model is expensive and the choice cannot
    change while the process runs.
    """
    configured = getattr(settings, 'FACE_ENGINE', 'auto')

    if configured == 'stub':
        if not settings.DEBUG and not getattr(settings, 'FACE_ALLOW_STUB', False):
            raise RuntimeError(
                'FACE_ENGINE=stub is refused outside DEBUG unless '
                'FACE_ALLOW_STUB=1 is set knowingly.'
            )
        return HashEngine()

    if configured in ('auto', 'opencv'):
        try:
            engine = OpenCVSFaceEngine()
            logger.info('Face engine: %s', engine.name)
            return engine
        except ImportError as exc:
            if configured == 'opencv':
                raise RuntimeError(
                    f'FACE_ENGINE=opencv but the engine could not load: {exc}'
                ) from exc
            logger.warning('OpenCV face engine unavailable: %s', exc)

    if configured in ('auto', 'face_recognition'):
        try:
            engine = FaceRecognitionEngine()
            logger.info('Face engine: %s', engine.name)
            return engine
        except ImportError:
            if configured == 'face_recognition':
                raise RuntimeError(
                    'FACE_ENGINE=face_recognition but the face_recognition '
                    'package is not installed. Run: pip install face-recognition'
                )
            logger.warning(
                'face_recognition not installed; falling back to the hash stub. '
                'Install face-recognition before going live.'
            )

    if not settings.DEBUG and getattr(settings, 'FACE_ALLOW_STUB', False) is not True:
        raise RuntimeError(
            'No real face recognition engine is available and the stub is '
            'disabled outside DEBUG. Install face-recognition, or set '
            'FACE_ALLOW_STUB=1 to accept the stub knowingly.'
        )
    return HashEngine()
