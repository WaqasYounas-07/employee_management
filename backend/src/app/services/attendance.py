"""Attendance rules: turning recognition events into attendance records.

The decisions that live here -- which sighting counts as a check-in, when a
second sighting is a duplicate rather than a check-out, how late is late --
are the business rules of the system. They are kept out of the views so they
can be tested and tuned on their own.
"""
from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from app.models import Attendance, Camera, Employee, Holiday, LeaveRequest, Shift

logger = logging.getLogger(__name__)


@dataclass
class AttendanceOutcome:
    """What the system did with one accepted sighting."""

    attendance: Attendance | None
    action: str  # check_in | check_out | duplicate | updated_check_out | ignored
    detail: str = ''


def _to_decimal(value: float) -> Decimal:
    return Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def shift_start_on(shift: Shift, date: dt.date) -> dt.datetime:
    """The aware datetime at which the shift begins on a given date."""
    naive = dt.datetime.combine(date, shift.start_time)
    return timezone.make_aware(naive, timezone.get_current_timezone())


def shift_end_on(shift: Shift, date: dt.date) -> dt.datetime:
    """The aware shift end, rolled to the next day for overnight shifts."""
    end_date = date + dt.timedelta(days=1) if shift.is_overnight else date
    naive = dt.datetime.combine(end_date, shift.end_time)
    return timezone.make_aware(naive, timezone.get_current_timezone())


def attendance_date_for(employee: Employee, moment: dt.datetime) -> dt.date:
    """Which working day a sighting belongs to.

    For an overnight shift, somebody clocking in at 23:30 and out at 07:00
    belongs to a single day -- the day the shift started -- so the early
    morning hours are attributed backwards.

    The window is inclusive of the shift end, and extends past it by a grace
    margin: leaving exactly at 06:00, or a few minutes after, is the ordinary
    case and must still land on the shift's own day rather than opening a
    second record on the new calendar date.
    """
    local = timezone.localtime(moment)
    shift = employee.shift
    if not shift.is_overnight:
        return local.date()

    cutoff = (
        dt.datetime.combine(local.date(), shift.end_time)
        + dt.timedelta(minutes=settings.ATTENDANCE_OVERNIGHT_GRACE_MINUTES)
    ).time()
    # A cutoff that wraps past midnight would swallow the next shift's start,
    # so it is clamped to the end of the day.
    if cutoff < shift.end_time:
        cutoff = dt.time(23, 59, 59)

    if local.time() <= cutoff:
        return local.date() - dt.timedelta(days=1)
    return local.date()


def is_non_working_day(employee: Employee, date: dt.date) -> tuple[bool, str]:
    """Whether the date is a holiday or approved leave for this employee."""
    holiday = Holiday.objects.filter(date=date, is_optional=False).first()
    if holiday:
        return True, Attendance.Status.HOLIDAY
    on_leave = LeaveRequest.objects.filter(
        employee=employee,
        status=LeaveRequest.Status.APPROVED,
        start_date__lte=date,
        end_date__gte=date,
    ).exists()
    if on_leave:
        return True, Attendance.Status.ON_LEAVE
    return False, ''


def classify_arrival(shift: Shift, check_in: dt.datetime, date: dt.date) -> tuple[str, int]:
    """Return (status, late_minutes) for an arrival time."""
    expected = shift_start_on(shift, date)
    grace = expected + dt.timedelta(minutes=shift.grace_minutes)
    if check_in <= grace:
        return Attendance.Status.PRESENT, 0
    late = int((check_in - expected).total_seconds() // 60)
    return Attendance.Status.LATE, late


def recompute_totals(attendance: Attendance) -> Attendance:
    """Recalculate hours, lateness and status from check_in/check_out.

    Safe to call repeatedly; it derives everything from the two timestamps.
    """
    shift = attendance.employee.shift

    if attendance.check_in:
        status, late = classify_arrival(shift, attendance.check_in, attendance.date)
        attendance.late_minutes = late
        # Never downgrade a manually set leave/holiday status.
        if attendance.status not in (
            Attendance.Status.ON_LEAVE, Attendance.Status.HOLIDAY
        ):
            attendance.status = status

    if attendance.check_in and attendance.check_out:
        worked = (attendance.check_out - attendance.check_in).total_seconds() / 3600
        worked = max(0.0, worked)
        attendance.worked_hours = _to_decimal(worked)

        full_day = float(shift.full_day_hours)
        half_day = float(shift.half_day_hours)
        if worked < half_day:
            attendance.status = Attendance.Status.HALF_DAY
        attendance.overtime_hours = _to_decimal(max(0.0, worked - full_day))

        expected_end = shift_end_on(shift, attendance.date)
        if attendance.check_out < expected_end:
            attendance.early_leave_minutes = int(
                (expected_end - attendance.check_out).total_seconds() // 60
            )
        else:
            attendance.early_leave_minutes = 0
    else:
        attendance.worked_hours = Decimal('0.00')
        attendance.overtime_hours = Decimal('0.00')

    return attendance


@transaction.atomic
def register_sighting(
    employee: Employee,
    camera: Camera,
    moment: dt.datetime | None = None,
) -> AttendanceOutcome:
    """Fold one confirmed sighting into the employee's attendance for the day.

    Rules, in order:
      1. First sighting of the day on an entry-capable camera -> check in.
      2. A sighting within the cooldown window of the last one is a duplicate
         (somebody lingering in front of the lens), and is ignored.
      3. A later sighting past the minimum work window -> check out, and a
         still-later one moves the check-out forward, so the last sighting of
         the day wins.
    """
    moment = moment or timezone.now()
    date = attendance_date_for(employee, moment)

    record = (
        Attendance.objects.select_for_update()
        .filter(employee=employee, date=date)
        .first()
    )

    cooldown = dt.timedelta(minutes=settings.ATTENDANCE_DUPLICATE_COOLDOWN_MINUTES)
    min_gap = dt.timedelta(minutes=settings.ATTENDANCE_MIN_CHECKOUT_MINUTES)

    if record is None:
        if camera.direction == Camera.Direction.OUT:
            # An exit-only camera saw somebody who never checked in. Record the
            # day anyway so the gap is visible rather than silently lost.
            record = Attendance.objects.create(
                employee=employee, date=date, check_out=moment,
                check_out_camera=camera, source=Attendance.Source.CAMERA,
                status=Attendance.Status.HALF_DAY,
                note='Exit seen without a matching entry.',
            )
            return AttendanceOutcome(record, 'check_out', 'Exit without entry.')

        non_working, status = is_non_working_day(employee, date)
        record = Attendance(
            employee=employee, date=date, check_in=moment,
            check_in_camera=camera, source=Attendance.Source.CAMERA,
        )
        if non_working:
            record.status = status
            record.note = 'Attended on a non-working day.'
        recompute_totals(record)
        record.save()
        return AttendanceOutcome(record, 'check_in', f'Checked in at {moment:%H:%M}.')

    last_seen = record.check_out or record.check_in
    if last_seen and moment - last_seen < cooldown:
        return AttendanceOutcome(record, 'duplicate', 'Within duplicate cooldown.')

    if camera.direction == Camera.Direction.IN and record.check_in:
        # An entry-only camera cannot produce a check-out.
        return AttendanceOutcome(record, 'duplicate', 'Re-entry on an entry-only camera.')

    if record.check_in and moment - record.check_in < min_gap:
        return AttendanceOutcome(
            record, 'duplicate',
            'Too soon after check-in to count as a check-out.',
        )

    action = 'updated_check_out' if record.check_out else 'check_out'
    record.check_out = moment
    record.check_out_camera = camera
    recompute_totals(record)
    record.save()
    return AttendanceOutcome(record, action, f'Checked out at {moment:%H:%M}.')


def mark_absentees(date: dt.date) -> int:
    """Create absent rows for active employees with no record for the date.

    Run at end of day. Holidays and approved leave are recorded as such rather
    than as absence.
    """
    seen = set(
        Attendance.objects.filter(date=date).values_list('employee_id', flat=True)
    )
    employees = Employee.objects.filter(
        status__in=[Employee.Status.ACTIVE, Employee.Status.PROBATION],
        date_joined__lte=date,
    ).exclude(id__in=seen).select_related('shift')

    rows = []
    for employee in employees:
        if employee.date_left and employee.date_left < date:
            continue
        non_working, status = is_non_working_day(employee, date)
        rows.append(
            Attendance(
                employee=employee,
                date=date,
                status=status if non_working else Attendance.Status.ABSENT,
                source=Attendance.Source.MANUAL,
                note='Generated by end-of-day sweep.',
            )
        )
    if rows:
        Attendance.objects.bulk_create(rows, ignore_conflicts=True)
    return len(rows)
