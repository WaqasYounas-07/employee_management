"""Tests for the attendance rules and the camera ingestion pipeline.

The rules engine is where the business logic lives, so it carries the bulk of
the coverage; the API tests check authentication boundaries and the one flow
that matters most -- a camera turning a face into an attendance record.

The test runner forces DEBUG=False, where `get_engine` refuses to hand out the
development stub. Suites that need recognition opt in with
`@override_settings(FACE_ENGINE='stub', FACE_ALLOW_STUB=True)` -- an explicit acknowledgement that
they are exercising the stub, not real face matching.
"""
import datetime as dt
import io

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from PIL import Image, ImageDraw
from django.test import override_settings
from rest_framework.test import APITestCase

from app.models import (
    Attendance, Camera, Department, Designation, Employee,
    Holiday, LeaveRequest, LeaveType, RolePermission, Shift,
)
from app.services import attendance as rules
from app.services.enrollment import enroll_face, invalidate_template_cache

User = get_user_model()


def make_face(seed: int) -> bytes:
    """A distinct image per seed, so the stub engine yields distinct vectors."""
    img = Image.new('RGB', (400, 400), (200, 200, 200))
    draw = ImageDraw.Draw(img)
    draw.ellipse([80, 60, 320, 340], fill=(180 + seed % 60, 150, 130))
    draw.text((20, 20), f'SEED{seed}', fill=(0, 0, 0))
    buffer = io.BytesIO()
    img.save(buffer, 'JPEG')
    return buffer.getvalue()


def upload(seed: int, name='face.jpg') -> SimpleUploadedFile:
    return SimpleUploadedFile(name, make_face(seed), content_type='image/jpeg')


class BaseFixture(TestCase):
    def setUp(self):
        from app.services.recognition import get_engine
        get_engine.cache_clear()  # the engine choice depends on settings
        invalidate_template_cache()
        self.shift = Shift.objects.create(
            name='General', start_time=dt.time(9, 0), end_time=dt.time(18, 0),
            grace_minutes=15, half_day_hours=4, full_day_hours=8,
        )
        self.night = Shift.objects.create(
            name='Night', start_time=dt.time(22, 0), end_time=dt.time(6, 0),
            grace_minutes=15, half_day_hours=4, full_day_hours=8,
        )
        self.department = Department.objects.create(name='Engineering', code='ENG')
        self.designation = Designation.objects.create(
            title='Engineer', department=self.department
        )
        self.employee = Employee.objects.create(
            employee_code='EMP001', first_name='Ayesha', last_name='Khan',
            email='ayesha@company.com', department=self.department,
            designation=self.designation, shift=self.shift,
        )
        self.camera = Camera.objects.create(
            name='Main Gate', location='Entrance', direction=Camera.Direction.BOTH,
            min_confidence=0.5,
        )
        self.today = timezone.localdate()

    def at(self, hour, minute=0, date=None):
        """An aware datetime at a local wall-clock time."""
        return timezone.make_aware(
            dt.datetime.combine(date or self.today, dt.time(hour, minute)),
            timezone.get_current_timezone(),
        )


class AttendanceRuleTests(BaseFixture):
    def test_first_sighting_checks_in(self):
        outcome = rules.register_sighting(self.employee, self.camera, self.at(9, 5))
        self.assertEqual(outcome.action, 'check_in')
        self.assertEqual(outcome.attendance.status, Attendance.Status.PRESENT)
        self.assertEqual(outcome.attendance.late_minutes, 0)

    def test_arrival_inside_grace_is_not_late(self):
        outcome = rules.register_sighting(self.employee, self.camera, self.at(9, 15))
        self.assertEqual(outcome.attendance.status, Attendance.Status.PRESENT)

    def test_arrival_after_grace_is_late(self):
        outcome = rules.register_sighting(self.employee, self.camera, self.at(9, 45))
        self.assertEqual(outcome.attendance.status, Attendance.Status.LATE)
        self.assertEqual(outcome.attendance.late_minutes, 45)

    def test_sighting_within_cooldown_is_a_duplicate(self):
        rules.register_sighting(self.employee, self.camera, self.at(9, 0))
        outcome = rules.register_sighting(self.employee, self.camera, self.at(9, 2))
        self.assertEqual(outcome.action, 'duplicate')
        self.assertIsNone(outcome.attendance.check_out)

    def test_sighting_too_soon_is_not_a_checkout(self):
        """Stepping out for ten minutes must not end the working day."""
        rules.register_sighting(self.employee, self.camera, self.at(9, 0))
        outcome = rules.register_sighting(self.employee, self.camera, self.at(9, 40))
        self.assertEqual(outcome.action, 'duplicate')
        self.assertIsNone(outcome.attendance.check_out)

    def test_later_sighting_checks_out_and_computes_hours(self):
        rules.register_sighting(self.employee, self.camera, self.at(9, 0))
        outcome = rules.register_sighting(self.employee, self.camera, self.at(18, 0))
        self.assertEqual(outcome.action, 'check_out')
        self.assertEqual(float(outcome.attendance.worked_hours), 9.0)
        self.assertEqual(float(outcome.attendance.overtime_hours), 1.0)

    def test_last_sighting_of_the_day_wins(self):
        rules.register_sighting(self.employee, self.camera, self.at(9, 0))
        rules.register_sighting(self.employee, self.camera, self.at(17, 0))
        outcome = rules.register_sighting(self.employee, self.camera, self.at(19, 0))
        self.assertEqual(outcome.action, 'updated_check_out')
        self.assertEqual(float(outcome.attendance.worked_hours), 10.0)

    def test_short_day_is_a_half_day(self):
        rules.register_sighting(self.employee, self.camera, self.at(9, 0))
        outcome = rules.register_sighting(self.employee, self.camera, self.at(12, 0))
        self.assertEqual(outcome.attendance.status, Attendance.Status.HALF_DAY)

    def test_early_leave_is_recorded(self):
        rules.register_sighting(self.employee, self.camera, self.at(9, 0))
        outcome = rules.register_sighting(self.employee, self.camera, self.at(16, 30))
        self.assertEqual(outcome.attendance.early_leave_minutes, 90)

    def test_entry_only_camera_never_checks_out(self):
        entry = Camera.objects.create(
            name='Turnstile', location='Gate', direction=Camera.Direction.IN
        )
        rules.register_sighting(self.employee, entry, self.at(9, 0))
        outcome = rules.register_sighting(self.employee, entry, self.at(18, 0))
        self.assertEqual(outcome.action, 'duplicate')
        self.assertIsNone(outcome.attendance.check_out)

    def test_exit_without_entry_is_recorded(self):
        exit_cam = Camera.objects.create(
            name='Exit', location='Back door', direction=Camera.Direction.OUT
        )
        outcome = rules.register_sighting(self.employee, exit_cam, self.at(18, 0))
        self.assertEqual(outcome.action, 'check_out')
        self.assertIsNone(outcome.attendance.check_in)
        self.assertIn('without', outcome.attendance.note.lower())

    def test_overnight_shift_belongs_to_the_starting_day(self):
        """23:30 in and 06:00 next morning out is one working day."""
        self.employee.shift = self.night
        self.employee.save()
        yesterday = self.today - dt.timedelta(days=1)

        rules.register_sighting(self.employee, self.camera, self.at(23, 30, yesterday))
        outcome = rules.register_sighting(self.employee, self.camera, self.at(6, 0))

        self.assertEqual(outcome.action, 'check_out')
        self.assertEqual(outcome.attendance.date, yesterday)
        self.assertEqual(Attendance.objects.count(), 1)
        self.assertEqual(float(outcome.attendance.worked_hours), 6.5)

    def test_absentee_sweep_marks_only_unseen_employees(self):
        seen = Employee.objects.create(
            employee_code='EMP002', first_name='Bilal', last_name='Ahmed',
            email='bilal@company.com', department=self.department,
            designation=self.designation, shift=self.shift,
        )
        rules.register_sighting(seen, self.camera, self.at(9, 0))

        created = rules.mark_absentees(self.today)

        self.assertEqual(created, 1)
        self.assertEqual(
            Attendance.objects.get(employee=self.employee).status,
            Attendance.Status.ABSENT,
        )
        self.assertEqual(
            Attendance.objects.get(employee=seen).status, Attendance.Status.PRESENT
        )

    def test_sweep_records_a_holiday_rather_than_absence(self):
        Holiday.objects.create(name='Independence Day', date=self.today)
        rules.mark_absentees(self.today)
        self.assertEqual(
            Attendance.objects.get(employee=self.employee).status,
            Attendance.Status.HOLIDAY,
        )

    def test_sweep_records_approved_leave_rather_than_absence(self):
        leave_type = LeaveType.objects.create(name='Annual', annual_quota=20)
        LeaveRequest.objects.create(
            employee=self.employee, leave_type=leave_type,
            start_date=self.today, end_date=self.today,
            status=LeaveRequest.Status.APPROVED,
        )
        rules.mark_absentees(self.today)
        self.assertEqual(
            Attendance.objects.get(employee=self.employee).status,
            Attendance.Status.ON_LEAVE,
        )

    def test_sweep_skips_employees_who_have_left(self):
        self.employee.date_left = self.today - dt.timedelta(days=1)
        self.employee.save()
        self.assertEqual(rules.mark_absentees(self.today), 0)


@override_settings(FACE_ENGINE='stub', FACE_ALLOW_STUB=True)
class EnrollmentTests(BaseFixture):
    def test_enrolling_a_face_creates_an_active_template(self):
        template = enroll_face(self.employee, upload(1))
        self.assertTrue(template.is_active)
        self.assertEqual(template.dimensions, len(template.embedding))
        self.assertTrue(self.employee.is_enrolled)

    def test_the_same_face_cannot_belong_to_two_employees(self):
        from app.services.enrollment import EnrollmentError

        other = Employee.objects.create(
            employee_code='EMP002', first_name='Bilal', last_name='Ahmed',
            email='bilal@company.com', department=self.department,
            designation=self.designation, shift=self.shift,
        )
        enroll_face(self.employee, upload(1))
        with self.assertRaises(EnrollmentError):
            enroll_face(other, upload(1))


@override_settings(FACE_ENGINE='stub', FACE_ALLOW_STUB=True)
class CameraIngestTests(APITestCase, BaseFixture):
    """The flow that matters most: a frame at the door becomes attendance."""

    def setUp(self):
        super().setUp()
        enroll_face(self.employee, upload(1))
        self.headers = {'HTTP_X_CAMERA_KEY': self.camera.api_key}

    def post_frame(self, seed=1, when=None):
        payload = {'image': upload(seed)}
        if when:
            payload['captured_at'] = when.isoformat()
        return self.client.post('/api/cameras/ingest/', payload, **self.headers)

    def test_a_frame_without_a_key_is_rejected(self):
        response = self.client.post('/api/cameras/ingest/', {'image': upload(1)})
        self.assertIn(response.status_code, (401, 403))

    def test_a_frame_with_an_unknown_key_is_rejected(self):
        response = self.client.post(
            '/api/cameras/ingest/', {'image': upload(1)},
            HTTP_X_CAMERA_KEY='not-a-real-key',
        )
        self.assertEqual(response.status_code, 401)

    def test_a_disabled_camera_is_rejected(self):
        self.camera.is_active = False
        self.camera.save()
        self.assertEqual(self.post_frame().status_code, 401)

    def test_a_recognised_face_checks_the_employee_in(self):
        response = self.post_frame(when=self.at(9, 5))
        self.assertEqual(response.status_code, 200)
        result = response.json()['results'][0]
        self.assertEqual(result['decision'], 'matched')
        self.assertEqual(result['attendance_action'], 'check_in')
        self.assertEqual(result['employee']['code'], 'EMP001')
        self.assertTrue(
            Attendance.objects.filter(employee=self.employee, date=self.today).exists()
        )

    def test_an_unknown_face_is_audited_but_marks_nobody(self):
        response = self.post_frame(seed=999, when=self.at(9, 5))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['results'][0]['decision'], 'no_match')
        self.assertFalse(Attendance.objects.exists())

    def test_a_full_day_produces_one_record(self):
        self.post_frame(when=self.at(9, 0))
        self.post_frame(when=self.at(18, 0))
        self.assertEqual(Attendance.objects.count(), 1)
        record = Attendance.objects.get()
        self.assertEqual(float(record.worked_hours), 9.0)

    def test_a_suspended_employee_stops_matching(self):
        self.employee.status = Employee.Status.SUSPENDED
        self.employee.save()
        invalidate_template_cache()
        response = self.post_frame(when=self.at(9, 5))
        self.assertEqual(response.json()['results'][0]['decision'], 'no_match')

    def test_ingestion_updates_the_camera_heartbeat(self):
        self.post_frame(when=self.at(9, 5))
        self.camera.refresh_from_db()
        self.assertIsNotNone(self.camera.last_seen_at)


class PermissionTests(APITestCase, BaseFixture):
    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_user(
            username='admin', email='admin@company.com',
            password='adminpass123', role=User.Role.ADMIN,
        )
        self.worker = User.objects.create_user(
            username='worker', email='worker@company.com',
            password='workerpass123', role=User.Role.EMPLOYEE,
        )
        self.employee.user = self.worker
        self.employee.save()

    def login(self, user, password):
        response = self.client.post(
            '/api/auth/login/', {'email': user.email, 'password': password},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {response.json()["access"]}'
        )

    def test_the_api_rejects_anonymous_requests(self):
        self.assertEqual(self.client.get('/api/employees/').status_code, 401)

    def test_an_employee_sees_only_their_own_record(self):
        Employee.objects.create(
            employee_code='EMP002', first_name='Bilal', last_name='Ahmed',
            email='bilal@company.com', department=self.department,
            designation=self.designation, shift=self.shift,
        )
        self.login(self.worker, 'workerpass123')
        response = self.client.get('/api/employees/')
        self.assertEqual(response.json()['count'], 1)

    def test_an_employee_cannot_create_employees(self):
        self.login(self.worker, 'workerpass123')
        response = self.client.post('/api/employees/', {
            'employee_code': 'EMP003', 'first_name': 'X', 'last_name': 'Y',
            'email': 'x@company.com', 'department': self.department.id,
            'designation': self.designation.id, 'shift': self.shift.id,
        }, format='json')
        self.assertEqual(response.status_code, 403)

    def test_an_employee_cannot_see_cameras(self):
        self.login(self.worker, 'workerpass123')
        self.assertEqual(self.client.get('/api/cameras/').status_code, 403)

    def test_an_admin_can_manage_employees_and_cameras(self):
        self.login(self.admin, 'adminpass123')
        self.assertEqual(self.client.get('/api/employees/').status_code, 200)
        self.assertEqual(self.client.get('/api/cameras/').status_code, 200)
        self.assertEqual(self.client.get('/api/dashboard/').status_code, 200)


class ValidationTests(APITestCase, BaseFixture):
    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_user(
            username='admin', email='admin@company.com',
            password='adminpass123', role=User.Role.ADMIN,
        )
        response = self.client.post(
            '/api/auth/login/',
            {'email': 'admin@company.com', 'password': 'adminpass123'},
            format='json',
        )
        self.client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {response.json()["access"]}'
        )

    def test_designation_must_belong_to_the_department(self):
        other = Department.objects.create(name='Sales', code='SLS')
        response = self.client.post('/api/employees/', {
            'employee_code': 'EMP010', 'first_name': 'X', 'last_name': 'Y',
            'email': 'x@company.com', 'department': other.id,
            'designation': self.designation.id, 'shift': self.shift.id,
        }, format='json')
        self.assertEqual(response.status_code, 400)

    def test_overlapping_leave_is_rejected(self):
        leave_type = LeaveType.objects.create(name='Annual', annual_quota=20)
        base = {'employee': self.employee.id, 'leave_type': leave_type.id}
        first = self.client.post('/api/leave-requests/', {
            **base,
            'start_date': str(self.today + dt.timedelta(days=5)),
            'end_date': str(self.today + dt.timedelta(days=8)),
        }, format='json')
        self.assertEqual(first.status_code, 201)

        second = self.client.post('/api/leave-requests/', {
            **base,
            'start_date': str(self.today + dt.timedelta(days=7)),
            'end_date': str(self.today + dt.timedelta(days=9)),
        }, format='json')
        self.assertEqual(second.status_code, 400)

    def test_approving_leave_fills_in_attendance(self):
        leave_type = LeaveType.objects.create(name='Annual', annual_quota=20)
        created = self.client.post('/api/leave-requests/', {
            'employee': self.employee.id, 'leave_type': leave_type.id,
            'start_date': str(self.today + dt.timedelta(days=5)),
            'end_date': str(self.today + dt.timedelta(days=7)),
        }, format='json')
        leave_id = created.json()['id']

        response = self.client.post(
            f'/api/leave-requests/{leave_id}/review/',
            {'status': 'approved'}, format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            Attendance.objects.filter(status=Attendance.Status.ON_LEAVE).count(), 3
        )

    def test_a_shift_needs_half_day_below_full_day(self):
        response = self.client.post('/api/shifts/', {
            'name': 'Broken', 'start_time': '09:00', 'end_time': '18:00',
            'half_day_hours': 9, 'full_day_hours': 8,
        }, format='json')
        self.assertEqual(response.status_code, 400)


class SuperuserRoleTests(TestCase):
    """`createsuperuser` knows nothing about `role`, and the API gates on
    `role` rather than `is_superuser`. These keep the two in step."""

    def test_createsuperuser_gets_the_admin_role(self):
        user = User.objects.create_superuser(
            username='root', email='root@company.com', password='rootpass123',
        )
        self.assertEqual(user.role, User.Role.ADMIN)
        self.assertTrue(user.is_staff_level)

    def test_promoting_an_existing_user_syncs_the_role(self):
        user = User.objects.create_user(
            username='someone', email='someone@company.com', password='pass12345',
        )
        self.assertEqual(user.role, User.Role.EMPLOYEE)

        user.is_superuser = True
        user.save()

        user.refresh_from_db()
        self.assertEqual(user.role, User.Role.ADMIN)

    def test_role_sync_survives_a_partial_save(self):
        """A save limited to `is_superuser` must still persist the new role."""
        user = User.objects.create_user(
            username='partial', email='partial@company.com', password='pass12345',
        )
        user.is_superuser = True
        user.save(update_fields=['is_superuser'])

        user.refresh_from_db()
        self.assertEqual(user.role, User.Role.ADMIN)

    def test_an_ordinary_user_is_not_promoted(self):
        user = User.objects.create_user(
            username='worker', email='worker@company.com', password='pass12345',
        )
        self.assertEqual(user.role, User.Role.EMPLOYEE)
        self.assertFalse(user.is_staff_level)


@override_settings(FACE_ENGINE='stub', FACE_ALLOW_STUB=True)
class AttendanceMatrixTests(APITestCase, BaseFixture):
    """The calendar grid endpoint: employees x days, pivoted."""

    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_user(
            username='admin', email='admin@company.com',
            password='adminpass123', role=User.Role.ADMIN,
        )
        response = self.client.post(
            '/api/auth/login/',
            {'email': 'admin@company.com', 'password': 'adminpass123'},
            format='json',
        )
        self.client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {response.json()["access"]}'
        )

    def test_matrix_returns_a_row_per_employee_and_a_column_per_day(self):
        start = self.today.replace(day=1)
        response = self.client.get(
            '/api/attendance/matrix/', {'start': start, 'end': self.today}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data['rows']), 1)
        self.assertEqual(len(data['days']), (self.today - start).days + 1)
        self.assertEqual(data['rows'][0]['employee']['code'], 'EMP001')

    def test_a_recorded_day_appears_in_the_row(self):
        rules.register_sighting(self.employee, self.camera, self.at(9, 45))

        response = self.client.get(
            '/api/attendance/matrix/',
            {'start': self.today, 'end': self.today},
        )
        cells = response.json()['rows'][0]['days']

        self.assertIn(self.today.isoformat(), cells)
        self.assertEqual(cells[self.today.isoformat()]['status'], 'late')
        self.assertEqual(cells[self.today.isoformat()]['late_minutes'], 45)

    def test_an_employee_with_no_records_still_gets_a_row(self):
        """A person absent all month must not vanish from the grid."""
        response = self.client.get(
            '/api/attendance/matrix/',
            {'start': self.today, 'end': self.today},
        )
        row = response.json()['rows'][0]
        self.assertEqual(row['days'], {})
        self.assertEqual(row['summary']['present'], 0)

    def test_weekends_and_holidays_are_flagged(self):
        start = self.today - dt.timedelta(days=13)
        Holiday.objects.create(name='Test Holiday', date=start)

        response = self.client.get(
            '/api/attendance/matrix/', {'start': start, 'end': self.today}
        )
        days = response.json()['days']

        self.assertTrue(days[0]['is_holiday'])
        self.assertTrue(any(day['is_weekend'] for day in days))

    def test_the_range_is_capped(self):
        response = self.client.get(
            '/api/attendance/matrix/',
            {'start': self.today - dt.timedelta(days=200), 'end': self.today},
        )
        self.assertEqual(response.status_code, 400)

    def test_an_inverted_range_is_rejected(self):
        response = self.client.get(
            '/api/attendance/matrix/',
            {'start': self.today, 'end': self.today - dt.timedelta(days=5)},
        )
        self.assertEqual(response.status_code, 400)

    def test_an_employee_only_sees_their_own_row(self):
        worker = User.objects.create_user(
            username='worker', email='worker@company.com',
            password='workerpass123', role=User.Role.EMPLOYEE,
        )
        self.employee.user = worker
        self.employee.save()
        Employee.objects.create(
            employee_code='EMP002', first_name='Bilal', last_name='Ahmed',
            email='bilal@company.com', department=self.department,
            designation=self.designation, shift=self.shift,
        )

        login = self.client.post(
            '/api/auth/login/',
            {'email': 'worker@company.com', 'password': 'workerpass123'},
            format='json',
        )
        self.client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {login.json()["access"]}'
        )

        response = self.client.get('/api/attendance/matrix/')
        rows = response.json()['rows']
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['employee']['code'], 'EMP001')


class PermissionMatrixTests(APITestCase, BaseFixture):
    """The editable role matrix, and that it really governs the API."""

    def setUp(self):
        super().setUp()
        RolePermission.objects.all().delete()
        self.admin = User.objects.create_user(
            username='admin', email='admin@company.com',
            password='adminpass123', role=User.Role.ADMIN,
        )
        self.worker = User.objects.create_user(
            username='worker', email='worker@company.com',
            password='workerpass123', role=User.Role.EMPLOYEE,
        )
        self.employee.user = self.worker
        self.employee.save()

    def auth(self, email, password):
        response = self.client.post(
            '/api/auth/login/', {'email': email, 'password': password}, format='json',
        )
        self.client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {response.json()["access"]}'
        )

    def test_defaults_are_seeded_on_first_read(self):
        self.auth('admin@company.com', 'adminpass123')
        response = self.client.get('/api/permissions/')

        self.assertEqual(response.status_code, 200)
        self.assertTrue(RolePermission.objects.exists())
        matrix = response.json()['matrix']
        self.assertIn('view_employees', matrix['hr'])
        self.assertNotIn('manage_cameras', matrix['employee'])

    def test_an_admin_always_holds_every_permission(self):
        granted = RolePermission.granted_for(User.Role.ADMIN)
        self.assertEqual(granted, set(RolePermission.Perm.values))

    def test_seeding_does_not_overwrite_an_edit(self):
        RolePermission.seed_defaults()
        RolePermission.objects.filter(
            role='employee', permission='view_cameras'
        ).update(granted=True)

        RolePermission.seed_defaults()

        self.assertIn('view_cameras', RolePermission.granted_for('employee'))

    def test_granting_a_permission_opens_the_endpoint(self):
        """The matrix is the real control, not a UI hint."""
        self.auth('worker@company.com', 'workerpass123')
        self.assertEqual(self.client.get('/api/cameras/').status_code, 403)

        self.auth('admin@company.com', 'adminpass123')
        self.client.post('/api/permissions/', {'changes': [
            {'role': 'employee', 'permission': 'manage_cameras', 'granted': True},
        ]}, format='json')

        self.auth('worker@company.com', 'workerpass123')
        self.assertEqual(self.client.get('/api/cameras/').status_code, 200)

    def test_revoking_a_permission_closes_the_endpoint(self):
        self.auth('worker@company.com', 'workerpass123')
        self.assertEqual(self.client.get('/api/employees/').status_code, 200)

        self.auth('admin@company.com', 'adminpass123')
        self.client.post('/api/permissions/', {'changes': [
            {'role': 'employee', 'permission': 'view_employees', 'granted': False},
        ]}, format='json')

        self.auth('worker@company.com', 'workerpass123')
        self.assertEqual(self.client.get('/api/employees/').status_code, 403)

    def test_an_employee_cannot_read_or_change_the_matrix(self):
        self.auth('worker@company.com', 'workerpass123')
        self.assertEqual(self.client.get('/api/permissions/').status_code, 403)
        self.assertEqual(
            self.client.post('/api/permissions/', {'changes': [
                {'role': 'employee', 'permission': 'manage_users', 'granted': True},
            ]}, format='json').status_code,
            403,
        )

    def test_the_admin_role_cannot_be_edited(self):
        """Otherwise an admin could lock every admin out of this page."""
        self.auth('admin@company.com', 'adminpass123')
        response = self.client.post('/api/permissions/', {'changes': [
            {'role': 'admin', 'permission': 'view_permissions', 'granted': False},
        ]}, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('view_permissions', RolePermission.granted_for(User.Role.ADMIN))

    def test_me_reports_the_callers_permissions(self):
        self.auth('worker@company.com', 'workerpass123')
        data = self.client.get('/api/auth/me/').json()

        self.assertIn('permissions', data)
        self.assertIn('view_attendance', data['permissions'])
        self.assertNotIn('manage_cameras', data['permissions'])

    def test_an_unknown_permission_is_rejected(self):
        self.auth('admin@company.com', 'adminpass123')
        response = self.client.post('/api/permissions/', {'changes': [
            {'role': 'hr', 'permission': 'not_a_real_permission', 'granted': True},
        ]}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_a_camera_device_holds_no_role_permissions(self):
        """A camera key authenticates a device, never a person."""
        response = self.client.get(
            '/api/employees/', HTTP_X_CAMERA_KEY=self.camera.api_key
        )
        self.assertIn(response.status_code, (401, 403))
