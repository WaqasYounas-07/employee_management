"""API views.

Grouped by concern: auth, org setup (departments/designations/shifts),
employees + face enrollment, cameras + frame ingestion, attendance, leave,
and reporting.
"""
from __future__ import annotations

import datetime as dt

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Avg, Count, Q, Sum
from django.utils import timezone
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.generics import GenericAPIView
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from app.api import serializers as s
from app.api.permissions import (
    CameraAPIKeyAuthentication,
    HasPermission,
    ReadOrPermission,
    IsAdmin,
    IsCameraDevice,
    IsHROrAdmin,
    IsStaffLevel,
    ReadOnlyForEmployees,
)
from app.models import (
    Attendance,
    Camera,
    Department,
    Designation,
    Employee,
    FaceTemplate,
    Holiday,
    LeaveRequest,
    LeaveType,
    RecognitionEvent,
    RolePermission,
    Shift,
)
from app.services import attendance as attendance_rules
from app.services.enrollment import (
    EnrollmentError,
    enroll_face,
    invalidate_template_cache,
    process_frame,
)

User = get_user_model()


def _parse_date(value: str | None, field: str) -> dt.date | None:
    if not value:
        return None
    parsed = dt.date.fromisoformat(value) if _is_iso(value) else None
    if parsed is None:
        raise ValidationError({field: 'Expected a date in YYYY-MM-DD format.'})
    return parsed


def _is_iso(value: str) -> bool:
    try:
        dt.date.fromisoformat(value)
        return True
    except (ValueError, TypeError):
        return False


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------

class RegisterView(GenericAPIView):
    """Create a login account. Restricted to admins: self-signup has no place
    in an internal HR system."""

    serializer_class = s.RegisterSerializer
    permission_classes = [HasPermission.of('manage_users')]

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(s.UserSerializer(user).data, status=status.HTTP_201_CREATED)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        data = s.UserSerializer(request.user).data
        employee = getattr(request.user, 'employee', None)
        data['employee'] = (
            s.EmployeeListSerializer(employee, context={'request': request}).data
            if employee else None
        )
        # The UI renders from this; the API still enforces it independently.
        data['permissions'] = sorted(RolePermission.granted_for(request.user.role))
        return Response(data)


class ChangePasswordView(GenericAPIView):
    serializer_class = s.ChangePasswordSerializer
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data['new_password'])
        request.user.save(update_fields=['password'])
        return Response({'detail': 'Password updated.'})


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all().order_by('id')
    serializer_class = s.UserSerializer
    permission_classes = [HasPermission.of('manage_users')]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['email', 'username', 'first_name', 'last_name']


# --------------------------------------------------------------------------
# Organisation setup
# --------------------------------------------------------------------------

class DepartmentViewSet(viewsets.ModelViewSet):
    serializer_class = s.DepartmentSerializer
    permission_classes = [ReadOrPermission.of('manage_settings')]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'code']

    def get_queryset(self):
        return Department.objects.annotate(
            employee_count=Count('employees', filter=Q(employees__status=Employee.Status.ACTIVE))
        ).order_by('name')


class DesignationViewSet(viewsets.ModelViewSet):
    queryset = Designation.objects.select_related('department').order_by('title')
    serializer_class = s.DesignationSerializer
    permission_classes = [ReadOrPermission.of('manage_settings')]
    filter_backends = [filters.SearchFilter]
    search_fields = ['title']

    def get_queryset(self):
        qs = super().get_queryset()
        department = self.request.query_params.get('department')
        if department:
            qs = qs.filter(department_id=department)
        return qs


class ShiftViewSet(viewsets.ModelViewSet):
    queryset = Shift.objects.all().order_by('name')
    serializer_class = s.ShiftSerializer
    permission_classes = [ReadOrPermission.of('manage_settings')]


class HolidayViewSet(viewsets.ModelViewSet):
    queryset = Holiday.objects.all()
    serializer_class = s.HolidaySerializer
    permission_classes = [ReadOrPermission.of('manage_settings')]

    def get_queryset(self):
        qs = super().get_queryset()
        year = self.request.query_params.get('year')
        if year:
            qs = qs.filter(date__year=year)
        return qs


# --------------------------------------------------------------------------
# Employees and face enrollment
# --------------------------------------------------------------------------

class EmployeeViewSet(viewsets.ModelViewSet):
    """Employee CRUD plus face enrollment.

    Employees may read their own record; managing records needs HR or Admin.
    """

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['employee_code', 'first_name', 'last_name', 'email', 'phone']
    ordering_fields = ['employee_code', 'date_joined', 'first_name', 'created_at']

    def get_queryset(self):
        qs = Employee.objects.select_related(
            'department', 'designation', 'shift', 'manager', 'user'
        ).prefetch_related('face_templates')

        user = self.request.user
        if not user.is_staff_level:
            # An ordinary employee only ever sees themselves.
            return qs.filter(user=user)

        if user.role == User.Role.MANAGER:
            employee = getattr(user, 'employee', None)
            if employee:
                qs = qs.filter(Q(manager=employee) | Q(id=employee.id))

        params = self.request.query_params
        if department := params.get('department'):
            qs = qs.filter(department_id=department)
        if designation := params.get('designation'):
            qs = qs.filter(designation_id=designation)
        if status_value := params.get('status'):
            qs = qs.filter(status=status_value)
        if enrolled := params.get('enrolled'):
            has_template = Q(face_templates__is_active=True)
            qs = qs.filter(has_template) if enrolled == 'true' else qs.exclude(has_template)
        return qs.distinct()

    def get_serializer_class(self):
        if self.action == 'list':
            return s.EmployeeListSerializer
        return s.EmployeeSerializer

    def get_permissions(self):
        if self.action == 'enroll_face':
            return [HasPermission.of('enrol_faces')()]
        if self.action in {'create', 'update', 'partial_update', 'destroy'}:
            return [HasPermission.of('manage_employees')()]
        return [HasPermission.of('view_employees')()]

    @action(detail=True, methods=['post'], url_path='enroll-face')
    def enroll_face(self, request, pk=None):
        """Register a face photo for this employee.

        Call it several times with different angles -- more templates mean a
        better match rate at the door.
        """
        employee = self.get_object()
        serializer = s.FaceEnrollSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            template = enroll_face(
                employee, serializer.validated_data['image'], enrolled_by=request.user
            )
        except EnrollmentError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                'detail': 'Face enrolled.',
                'template': s.FaceTemplateSerializer(template).data,
                'total_templates': employee.face_templates.filter(is_active=True).count(),
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['get'], url_path='face-templates')
    def face_templates(self, request, pk=None):
        employee = self.get_object()
        templates = employee.face_templates.all().order_by('-created_at')
        return Response(s.FaceTemplateSerializer(templates, many=True).data)

    @action(detail=True, methods=['get'])
    def attendance(self, request, pk=None):
        """This employee's attendance over a date range, with a summary."""
        employee = self.get_object()
        start = _parse_date(request.query_params.get('start'), 'start')
        end = _parse_date(request.query_params.get('end'), 'end')
        today = timezone.localdate()
        start = start or today.replace(day=1)
        end = end or today

        rows = Attendance.objects.filter(
            employee=employee, date__gte=start, date__lte=end
        ).order_by('-date')

        summary = rows.aggregate(
            present=Count('id', filter=Q(status=Attendance.Status.PRESENT)),
            late=Count('id', filter=Q(status=Attendance.Status.LATE)),
            absent=Count('id', filter=Q(status=Attendance.Status.ABSENT)),
            half_day=Count('id', filter=Q(status=Attendance.Status.HALF_DAY)),
            on_leave=Count('id', filter=Q(status=Attendance.Status.ON_LEAVE)),
            total_hours=Sum('worked_hours'),
            total_overtime=Sum('overtime_hours'),
        )
        return Response({
            'employee': s.EmployeeListSerializer(employee, context={'request': request}).data,
            'start': start, 'end': end,
            'summary': summary,
            'records': s.AttendanceSerializer(rows, many=True).data,
        })


class FaceTemplateViewSet(viewsets.ModelViewSet):
    """Deactivating a bad template is the usual fix for a camera that keeps
    mis-matching somebody, so deletion stays available to HR."""

    queryset = FaceTemplate.objects.select_related('employee').order_by('-created_at')
    serializer_class = s.FaceTemplateSerializer
    permission_classes = [HasPermission.of('enrol_faces')]
    http_method_names = ['get', 'delete', 'post', 'head', 'options']

    def get_queryset(self):
        qs = super().get_queryset()
        if employee := self.request.query_params.get('employee'):
            qs = qs.filter(employee_id=employee)
        return qs

    def perform_destroy(self, instance):
        super().perform_destroy(instance)
        invalidate_template_cache()

    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        template = self.get_object()
        template.is_active = False
        template.save(update_fields=['is_active', 'updated_at'])
        invalidate_template_cache()
        return Response({'detail': 'Template deactivated.'})


# --------------------------------------------------------------------------
# Cameras and frame ingestion
# --------------------------------------------------------------------------

class CameraViewSet(viewsets.ModelViewSet):
    queryset = Camera.objects.all().order_by('name')
    serializer_class = s.CameraSerializer
    permission_classes = [HasPermission.of('manage_cameras')]

    @action(detail=True, methods=['get'], url_path='key')
    def reveal_key(self, request, pk=None):
        """Show the device key so it can be configured on the camera."""
        camera = self.get_object()
        return Response({'api_key': camera.api_key})

    @action(detail=True, methods=['post'], url_path='rotate-key')
    def rotate_key(self, request, pk=None):
        """Issue a new key; the old one stops working immediately."""
        import uuid
        camera = self.get_object()
        camera.api_key = uuid.uuid4().hex
        camera.save(update_fields=['api_key', 'updated_at'])
        return Response({'api_key': camera.api_key})

    @action(detail=True, methods=['get'])
    def events(self, request, pk=None):
        camera = self.get_object()
        events = camera.events.select_related('employee')[:100]
        return Response(s.RecognitionEventSerializer(events, many=True).data)


class FrameIngestView(APIView):
    """`POST /api/cameras/ingest/` -- the endpoint the door camera calls.

    Authenticated by the camera's own key, not a user JWT. Returns a small
    payload per detected face so the edge device can show feedback on a
    screen at the door.
    """

    authentication_classes = [CameraAPIKeyAuthentication]
    permission_classes = [IsCameraDevice]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        serializer = s.FrameIngestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        camera: Camera = request.user.camera
        results = process_frame(
            camera=camera,
            image=serializer.validated_data['image'],
            captured_at=serializer.validated_data.get('captured_at'),
        )

        payload = []
        for result in results:
            payload.append({
                'decision': result.event.decision,
                'confidence': round(result.event.confidence, 4),
                'employee': (
                    {
                        'id': result.employee.id,
                        'code': result.employee.employee_code,
                        'name': result.employee.full_name,
                    } if result.employee else None
                ),
                'attendance_action': result.attendance_action,
                'message': result.detail,
                'event_id': result.event.id,
                # Fractions of the frame, so the client can draw a box over
                # its own video at whatever size it is displayed.
                'box': result.box,
            })

        return Response(
            {'camera': camera.name, 'faces': len(payload), 'results': payload},
            status=status.HTTP_200_OK,
        )


class RecognitionEventViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only audit log. Useful for working out why somebody was not
    recognised at the gate."""

    serializer_class = s.RecognitionEventSerializer
    permission_classes = [HasPermission.of('view_recognition_log')]

    def get_queryset(self):
        qs = RecognitionEvent.objects.select_related('employee', 'camera')
        params = self.request.query_params
        if camera := params.get('camera'):
            qs = qs.filter(camera_id=camera)
        if employee := params.get('employee'):
            qs = qs.filter(employee_id=employee)
        if decision := params.get('decision'):
            qs = qs.filter(decision=decision)
        if date := _parse_date(params.get('date'), 'date'):
            qs = qs.filter(captured_at__date=date)
        return qs


# --------------------------------------------------------------------------
# Attendance
# --------------------------------------------------------------------------

class AttendanceViewSet(viewsets.ModelViewSet):
    """Attendance records. Writes are HR corrections of camera data."""

    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['date', 'check_in', 'worked_hours']

    def get_serializer_class(self):
        if self.action in {'create', 'update', 'partial_update'}:
            return s.ManualAttendanceSerializer
        return s.AttendanceSerializer

    def get_permissions(self):
        if self.action in {'create', 'update', 'partial_update', 'destroy'}:
            return [HasPermission.of('correct_attendance')()]
        return [HasPermission.of('view_attendance')()]

    def get_queryset(self):
        qs = Attendance.objects.select_related(
            'employee', 'employee__department'
        )
        user = self.request.user
        if not user.is_staff_level:
            qs = qs.filter(employee__user=user)
        elif user.role == User.Role.MANAGER:
            employee = getattr(user, 'employee', None)
            if employee:
                qs = qs.filter(Q(employee__manager=employee) | Q(employee=employee))

        params = self.request.query_params
        if employee := params.get('employee'):
            qs = qs.filter(employee_id=employee)
        if department := params.get('department'):
            qs = qs.filter(employee__department_id=department)
        if status_value := params.get('status'):
            qs = qs.filter(status=status_value)
        if date := _parse_date(params.get('date'), 'date'):
            qs = qs.filter(date=date)
        if start := _parse_date(params.get('start'), 'start'):
            qs = qs.filter(date__gte=start)
        if end := _parse_date(params.get('end'), 'end'):
            qs = qs.filter(date__lte=end)
        return qs

    def perform_create(self, serializer):
        record = serializer.save(
            source=Attendance.Source.MANUAL, marked_by=self.request.user
        )
        attendance_rules.recompute_totals(record)
        record.save()

    def perform_update(self, serializer):
        record = serializer.save(marked_by=self.request.user)
        attendance_rules.recompute_totals(record)
        record.save()

    @action(detail=False, methods=['get'])
    def today(self, request):
        """Live board for the current day."""
        today = timezone.localdate()
        rows = self.get_queryset().filter(date=today)
        active = Employee.objects.filter(
            status__in=[Employee.Status.ACTIVE, Employee.Status.PROBATION]
        ).count()
        counts = rows.aggregate(
            present=Count('id', filter=Q(status=Attendance.Status.PRESENT)),
            late=Count('id', filter=Q(status=Attendance.Status.LATE)),
            half_day=Count('id', filter=Q(status=Attendance.Status.HALF_DAY)),
            on_leave=Count('id', filter=Q(status=Attendance.Status.ON_LEAVE)),
            checked_out=Count('id', filter=Q(check_out__isnull=False)),
        )
        counts['total_employees'] = active
        counts['marked'] = rows.count()
        counts['not_yet_arrived'] = max(0, active - rows.count())
        return Response({
            'date': today,
            'summary': counts,
            'records': s.AttendanceSerializer(rows.order_by('-check_in'), many=True).data,
        })

    @action(detail=False, methods=['post'], url_path='mark-absentees',
            permission_classes=[HasPermission.of('correct_attendance')])
    def mark_absentees(self, request):
        """End-of-day sweep: record everyone the cameras never saw as absent."""
        date = _parse_date(request.data.get('date'), 'date') or timezone.localdate()
        created = attendance_rules.mark_absentees(date)
        return Response({'date': date, 'absentees_marked': created})

    @action(detail=False, methods=['get'])
    def matrix(self, request):
        """Attendance pivoted to employees x days, for the calendar grid.

        The paginated list returns one row per record, so a month of staff
        would be hundreds of rows over many pages just to draw one grid. This
        returns the whole range already pivoted, in a single request.

        A day with no record is reported as `null` rather than absent: nothing
        was recorded, which is not the same as a recorded absence, and only
        the end-of-day sweep decides that.
        """
        today = timezone.localdate()
        start = _parse_date(request.query_params.get('start'), 'start') or today.replace(day=1)
        end = _parse_date(request.query_params.get('end'), 'end') or today
        if start > end:
            raise ValidationError({'start': 'Start date must be on or before the end date.'})
        if (end - start).days > 92:
            raise ValidationError(
                {'end': 'Range too large; request 92 days or fewer.'}
            )

        records = self.get_queryset().filter(date__gte=start, date__lte=end)

        # Which employees form the rows: everyone the viewer may see, not only
        # those with a record, so a person absent all month still appears.
        employees = Employee.objects.select_related('department', 'designation')
        user = request.user
        if not user.is_staff_level:
            employees = employees.filter(user=user)
        elif user.role == User.Role.MANAGER:
            own = getattr(user, 'employee', None)
            if own:
                employees = employees.filter(Q(manager=own) | Q(id=own.id))

        params = request.query_params
        if department := params.get('department'):
            employees = employees.filter(department_id=department)
        if status_value := params.get('employee_status'):
            employees = employees.filter(status=status_value)
        else:
            employees = employees.filter(
                status__in=[Employee.Status.ACTIVE, Employee.Status.PROBATION]
            )
        if search := params.get('search'):
            employees = employees.filter(
                Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(employee_code__icontains=search)
            )

        employees = employees.order_by('first_name', 'last_name')

        by_employee = {}
        for row in records.values(
            'employee_id', 'date', 'status', 'check_in', 'check_out',
            'worked_hours', 'late_minutes',
        ):
            by_employee.setdefault(row['employee_id'], {})[row['date'].isoformat()] = {
                'status': row['status'],
                'check_in': row['check_in'],
                'check_out': row['check_out'],
                'worked_hours': row['worked_hours'],
                'late_minutes': row['late_minutes'],
            }

        days = []
        cursor = start
        while cursor <= end:
            days.append(cursor)
            cursor += dt.timedelta(days=1)

        holidays = set(
            Holiday.objects.filter(date__gte=start, date__lte=end)
            .values_list('date', flat=True)
        )

        rows = []
        for employee in employees:
            cells = by_employee.get(employee.id, {})
            counts = {'present': 0, 'late': 0, 'absent': 0, 'half_day': 0, 'on_leave': 0}
            for cell in cells.values():
                if cell['status'] in counts:
                    counts[cell['status']] += 1
            rows.append({
                'employee': {
                    'id': employee.id,
                    'code': employee.employee_code,
                    'name': employee.full_name,
                    'photo': employee.photo.url if employee.photo else None,
                    'department': employee.department.name,
                    'designation': employee.designation.title,
                },
                'days': cells,
                'summary': counts,
            })

        return Response({
            'start': start,
            'end': end,
            'days': [
                {
                    'date': day,
                    'weekday': day.strftime('%a'),
                    'day': day.day,
                    'is_weekend': day.weekday() >= 5,
                    'is_holiday': day in holidays,
                    'is_future': day > today,
                }
                for day in days
            ],
            'rows': rows,
        })


# --------------------------------------------------------------------------
# Leave
# --------------------------------------------------------------------------

class LeaveTypeViewSet(viewsets.ModelViewSet):
    queryset = LeaveType.objects.all().order_by('name')
    serializer_class = s.LeaveTypeSerializer
    permission_classes = [ReadOrPermission.of('manage_settings')]


class LeaveRequestViewSet(viewsets.ModelViewSet):
    serializer_class = s.LeaveRequestSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = LeaveRequest.objects.select_related('employee', 'leave_type')
        user = self.request.user
        if not user.is_staff_level:
            qs = qs.filter(employee__user=user)
        elif user.role == User.Role.MANAGER:
            employee = getattr(user, 'employee', None)
            if employee:
                qs = qs.filter(Q(employee__manager=employee) | Q(employee=employee))

        params = self.request.query_params
        if status_value := params.get('status'):
            qs = qs.filter(status=status_value)
        if employee := params.get('employee'):
            qs = qs.filter(employee_id=employee)
        return qs

    def perform_create(self, serializer):
        """An ordinary employee may only file leave for themselves."""
        user = self.request.user
        employee = serializer.validated_data.get('employee')
        if not user.is_staff_level:
            own = getattr(user, 'employee', None)
            if own is None:
                raise ValidationError('Your account is not linked to an employee record.')
            if employee and employee.id != own.id:
                raise ValidationError('You can only request leave for yourself.')
            serializer.save(employee=own)
        else:
            serializer.save()

    @action(detail=True, methods=['post'],
            permission_classes=[HasPermission.of('approve_leave')])
    def review(self, request, pk=None):
        """Approve or reject. Approving backfills attendance as on-leave so the
        end-of-day sweep does not later mark those days absent."""
        leave = self.get_object()
        if leave.status != LeaveRequest.Status.PENDING:
            return Response(
                {'detail': f'This request is already {leave.status}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = s.LeaveReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        leave.status = serializer.validated_data['status']
        leave.review_note = serializer.validated_data.get('review_note', '')
        leave.reviewed_by = request.user
        leave.reviewed_at = timezone.now()
        leave.save()

        if leave.status == LeaveRequest.Status.APPROVED:
            self._apply_leave_to_attendance(leave)

        return Response(s.LeaveRequestSerializer(leave).data)

    @staticmethod
    def _apply_leave_to_attendance(leave: LeaveRequest) -> None:
        day = leave.start_date
        while day <= leave.end_date:
            Attendance.objects.update_or_create(
                employee=leave.employee,
                date=day,
                defaults={
                    'status': Attendance.Status.ON_LEAVE,
                    'source': Attendance.Source.MANUAL,
                    'note': f'Approved leave: {leave.leave_type.name}',
                },
            )
            day += dt.timedelta(days=1)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        leave = self.get_object()
        user = request.user
        own = getattr(user, 'employee', None)
        if not user.is_staff_level and (own is None or leave.employee_id != own.id):
            return Response(
                {'detail': 'You can only cancel your own request.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if leave.status not in {LeaveRequest.Status.PENDING, LeaveRequest.Status.APPROVED}:
            return Response(
                {'detail': f'Cannot cancel a {leave.status} request.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        leave.status = LeaveRequest.Status.CANCELLED
        leave.save(update_fields=['status', 'updated_at'])
        return Response(s.LeaveRequestSerializer(leave).data)


# --------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------

class DashboardView(APIView):
    """Headline numbers for the admin dashboard."""

    permission_classes = [HasPermission.of('view_reports')]

    def get(self, request):
        today = timezone.localdate()
        month_start = today.replace(day=1)

        employees = Employee.objects.all()
        active = employees.filter(
            status__in=[Employee.Status.ACTIVE, Employee.Status.PROBATION]
        )
        active_count = active.count()

        today_rows = Attendance.objects.filter(date=today)
        today_counts = today_rows.aggregate(
            present=Count('id', filter=Q(status=Attendance.Status.PRESENT)),
            late=Count('id', filter=Q(status=Attendance.Status.LATE)),
            absent=Count('id', filter=Q(status=Attendance.Status.ABSENT)),
            on_leave=Count('id', filter=Q(status=Attendance.Status.ON_LEAVE)),
        )
        marked = today_rows.count()

        enrolled = active.filter(face_templates__is_active=True).distinct().count()

        return Response({
            'date': today,
            'employees': {
                'total': employees.count(),
                'active': active_count,
                'enrolled_faces': enrolled,
                'not_enrolled': max(0, active_count - enrolled),
            },
            'today': {
                **today_counts,
                'marked': marked,
                'not_yet_arrived': max(0, active_count - marked),
                'attendance_rate': round(
                    (today_counts['present'] + today_counts['late']) / active_count * 100, 1
                ) if active_count else 0.0,
            },
            'month_to_date': Attendance.objects.filter(
                date__gte=month_start, date__lte=today
            ).aggregate(
                total_hours=Sum('worked_hours'),
                total_overtime=Sum('overtime_hours'),
                avg_late_minutes=Avg('late_minutes'),
            ),
            'cameras': {
                'total': Camera.objects.count(),
                'active': Camera.objects.filter(is_active=True).count(),
                'online': Camera.objects.filter(
                    last_seen_at__gte=timezone.now() - dt.timedelta(minutes=5)
                ).count(),
            },
            'pending_leave_requests': LeaveRequest.objects.filter(
                status=LeaveRequest.Status.PENDING
            ).count(),
            'department_breakdown': list(
                Department.objects.annotate(
                    employees_count=Count(
                        'employees', filter=Q(employees__status=Employee.Status.ACTIVE)
                    ),
                    present_today=Count(
                        'employees__attendance',
                        filter=Q(
                            employees__attendance__date=today,
                            employees__attendance__status__in=[
                                Attendance.Status.PRESENT, Attendance.Status.LATE
                            ],
                        ),
                    ),
                ).values('id', 'name', 'employees_count', 'present_today')
            ),
        })


class AttendanceReportView(APIView):
    """Per-employee totals over a range -- the basis for payroll export."""

    permission_classes = [HasPermission.of('view_reports')]

    def get(self, request):
        today = timezone.localdate()
        start = _parse_date(request.query_params.get('start'), 'start') or today.replace(day=1)
        end = _parse_date(request.query_params.get('end'), 'end') or today
        if start > end:
            raise ValidationError({'start': 'Start date must be on or before the end date.'})

        rows = Attendance.objects.filter(date__gte=start, date__lte=end)
        if department := request.query_params.get('department'):
            rows = rows.filter(employee__department_id=department)

        summary = (
            rows.values(
                'employee__id', 'employee__employee_code',
                'employee__first_name', 'employee__last_name',
                'employee__department__name',
            )
            .annotate(
                present_days=Count('id', filter=Q(status=Attendance.Status.PRESENT)),
                late_days=Count('id', filter=Q(status=Attendance.Status.LATE)),
                half_days=Count('id', filter=Q(status=Attendance.Status.HALF_DAY)),
                absent_days=Count('id', filter=Q(status=Attendance.Status.ABSENT)),
                leave_days=Count('id', filter=Q(status=Attendance.Status.ON_LEAVE)),
                total_hours=Sum('worked_hours'),
                overtime_hours=Sum('overtime_hours'),
                total_late_minutes=Sum('late_minutes'),
            )
            .order_by('employee__employee_code')
        )

        return Response({'start': start, 'end': end, 'rows': list(summary)})


# --------------------------------------------------------------------------
# Role permissions
# --------------------------------------------------------------------------

class PermissionMatrixView(APIView):
    """Read and edit what each role may do.

    `GET` returns the whole matrix plus the metadata the page needs to render
    it (labels, grouping, which roles are editable).

    `POST` applies a batch of changes in one transaction, so a half-applied
    matrix can never be left behind.
    """

    permission_classes = [HasPermission.of('view_permissions')]

    #: How the page groups the checkboxes. Pages first, then the actions
    #: that belong to them, so the matrix reads top to bottom like the app.
    GROUPS = [
        {
            'key': 'pages',
            'label': 'Pages',
            'description': 'Which sections of the app a role can open.',
            'permissions': [
                RolePermission.Perm.VIEW_DASHBOARD,
                RolePermission.Perm.VIEW_EMPLOYEES,
                RolePermission.Perm.VIEW_ATTENDANCE,
                RolePermission.Perm.VIEW_LEAVE,
                RolePermission.Perm.VIEW_CAMERAS,
                RolePermission.Perm.VIEW_RECOGNITION_LOG,
                RolePermission.Perm.VIEW_REPORTS,
                RolePermission.Perm.VIEW_TASKS,
                RolePermission.Perm.VIEW_SETTINGS,
                RolePermission.Perm.VIEW_PERMISSIONS,
            ],
        },
        {
            'key': 'people',
            'label': 'People',
            'description': 'Managing employee records and face enrolment.',
            'permissions': [
                RolePermission.Perm.MANAGE_EMPLOYEES,
                RolePermission.Perm.ENROL_FACES,
                RolePermission.Perm.MANAGE_USERS,
            ],
        },
        {
            'key': 'attendance',
            'label': 'Attendance and leave',
            'description': 'Correcting the record and approving time off.',
            'permissions': [
                RolePermission.Perm.CORRECT_ATTENDANCE,
                RolePermission.Perm.APPROVE_LEAVE,
            ],
        },
        {
            'key': 'tasks',
            'label': 'Tasks and boards',
            'description': 'Kanban boards, cards and who they are assigned to.',
            'permissions': [
                RolePermission.Perm.VIEW_TASKS,
                RolePermission.Perm.MANAGE_BOARDS,
                RolePermission.Perm.MANAGE_TASKS,
                RolePermission.Perm.ASSIGN_TASKS,
            ],
        },
        {
            'key': 'system',
            'label': 'System',
            'description': 'Cameras, organisation settings and this page.',
            'permissions': [
                RolePermission.Perm.MANAGE_CAMERAS,
                RolePermission.Perm.MANAGE_SETTINGS,
                RolePermission.Perm.MANAGE_PERMISSIONS,
            ],
        },
    ]

    def get(self, request):
        RolePermission.seed_defaults()

        roles = [User.Role.ADMIN, *RolePermission.EDITABLE_ROLES]
        matrix = {role: sorted(RolePermission.granted_for(role)) for role in roles}

        labels = dict(RolePermission.Perm.choices)
        return Response({
            'roles': [
                {
                    'value': role,
                    'label': User.Role(role).label,
                    # Admin is fixed so nobody can lock every admin out of
                    # the page that would let them undo it.
                    'editable': role in RolePermission.EDITABLE_ROLES,
                }
                for role in roles
            ],
            'groups': [
                {
                    'key': group['key'],
                    'label': group['label'],
                    'description': group['description'],
                    'permissions': [
                        {'value': perm, 'label': labels[perm]}
                        for perm in group['permissions']
                    ],
                }
                for group in self.GROUPS
            ],
            'matrix': matrix,
        })

    @transaction.atomic
    def post(self, request):
        if 'manage_permissions' not in RolePermission.granted_for(request.user.role):
            return Response(
                {'detail': 'Your role is not allowed to change permissions.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = s.PermissionMatrixBulkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        changes = serializer.validated_data['changes']
        for change in changes:
            RolePermission.objects.update_or_create(
                role=change['role'],
                permission=change['permission'],
                defaults={'granted': change['granted']},
            )

        roles = [User.Role.ADMIN, *RolePermission.EDITABLE_ROLES]
        return Response({
            'detail': f'{len(changes)} permission(s) updated.',
            'matrix': {role: sorted(RolePermission.granted_for(role)) for role in roles},
        })
