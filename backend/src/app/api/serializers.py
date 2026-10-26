"""DRF serializers. Read serializers expose nested names; write serializers
take ids, so the frontend never has to flatten objects before posting."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import serializers

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

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'role', 'phone']
        read_only_fields = ['id']


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8, style={'input_type': 'password'})

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'password', 'first_name', 'last_name', 'role', 'phone']

    def create(self, validated_data):
        password = validated_data.pop('password')
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_current_password(self, value):
        if not self.context['request'].user.check_password(value):
            raise serializers.ValidationError('Current password is incorrect.')
        return value


class DepartmentSerializer(serializers.ModelSerializer):
    employee_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Department
        fields = ['id', 'name', 'code', 'description', 'employee_count', 'created_at']


class DesignationSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)

    class Meta:
        model = Designation
        fields = ['id', 'title', 'department', 'department_name', 'created_at']


class ShiftSerializer(serializers.ModelSerializer):
    is_overnight = serializers.BooleanField(read_only=True)

    class Meta:
        model = Shift
        fields = [
            'id', 'name', 'start_time', 'end_time', 'grace_minutes',
            'half_day_hours', 'full_day_hours', 'is_overnight',
        ]

    def validate(self, attrs):
        half = attrs.get('half_day_hours', getattr(self.instance, 'half_day_hours', None))
        full = attrs.get('full_day_hours', getattr(self.instance, 'full_day_hours', None))
        if half is not None and full is not None and half >= full:
            raise serializers.ValidationError(
                {'half_day_hours': 'Half day hours must be less than full day hours.'}
            )
        return attrs


class FaceTemplateSerializer(serializers.ModelSerializer):
    """Never exposes the raw embedding -- it is biometric data, and the
    frontend has no use for the vector itself."""

    class Meta:
        model = FaceTemplate
        fields = [
            'id', 'employee', 'engine', 'dimensions', 'quality_score',
            'is_active', 'source_image', 'created_at',
        ]
        read_only_fields = fields


class EmployeeListSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    department_name = serializers.CharField(source='department.name', read_only=True)
    designation_title = serializers.CharField(source='designation.title', read_only=True)
    is_enrolled = serializers.BooleanField(read_only=True)

    class Meta:
        model = Employee
        fields = [
            'id', 'employee_code', 'full_name', 'email', 'phone', 'photo',
            'department', 'department_name', 'designation', 'designation_title',
            'status', 'employment_type', 'date_joined', 'is_enrolled',
        ]


class EmployeeSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    department_name = serializers.CharField(source='department.name', read_only=True)
    designation_title = serializers.CharField(source='designation.title', read_only=True)
    shift_name = serializers.CharField(source='shift.name', read_only=True)
    manager_name = serializers.CharField(source='manager.full_name', read_only=True)
    is_enrolled = serializers.BooleanField(read_only=True)
    face_templates = FaceTemplateSerializer(many=True, read_only=True)

    # Optional login account, created in the same request as the employee.
    create_login = serializers.BooleanField(write_only=True, required=False, default=False)
    password = serializers.CharField(
        write_only=True, required=False, min_length=8, style={'input_type': 'password'}
    )

    class Meta:
        model = Employee
        fields = [
            'id', 'employee_code', 'first_name', 'last_name', 'full_name',
            'email', 'phone', 'cnic', 'date_of_birth', 'address', 'photo',
            'department', 'department_name', 'designation', 'designation_title',
            'shift', 'shift_name', 'manager', 'manager_name',
            'employment_type', 'status', 'date_joined', 'date_left', 'salary',
            'user', 'is_enrolled', 'face_templates',
            'create_login', 'password', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'user', 'created_at', 'updated_at']

    def validate(self, attrs):
        designation = attrs.get('designation') or getattr(self.instance, 'designation', None)
        department = attrs.get('department') or getattr(self.instance, 'department', None)
        if designation and department and designation.department_id != department.id:
            raise serializers.ValidationError(
                {'designation': 'Designation does not belong to the selected department.'}
            )

        manager = attrs.get('manager')
        if manager and self.instance and manager.id == self.instance.id:
            raise serializers.ValidationError(
                {'manager': 'An employee cannot be their own manager.'}
            )

        if attrs.get('create_login') and not attrs.get('password'):
            raise serializers.ValidationError(
                {'password': 'A password is required when creating a login.'}
            )

        date_left = attrs.get('date_left') or getattr(self.instance, 'date_left', None)
        date_joined = attrs.get('date_joined') or getattr(self.instance, 'date_joined', None)
        if date_left and date_joined and date_left < date_joined:
            raise serializers.ValidationError(
                {'date_left': 'Leaving date cannot be before the joining date.'}
            )
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        create_login = validated_data.pop('create_login', False)
        password = validated_data.pop('password', None)

        employee = Employee.objects.create(**validated_data)

        if create_login:
            user = User(
                username=employee.employee_code,
                email=employee.email,
                first_name=employee.first_name,
                last_name=employee.last_name,
                phone=employee.phone,
                role=User.Role.EMPLOYEE,
            )
            user.set_password(password)
            user.save()
            employee.user = user
            employee.save(update_fields=['user', 'updated_at'])

        return employee

    def update(self, instance, validated_data):
        validated_data.pop('create_login', None)
        validated_data.pop('password', None)
        return super().update(instance, validated_data)


class FaceEnrollSerializer(serializers.Serializer):
    image = serializers.ImageField()


class CameraSerializer(serializers.ModelSerializer):
    """`api_key` is write-protected and only revealed through the dedicated
    rotate/reveal action, so it does not leak into every list response."""

    is_online = serializers.SerializerMethodField()

    class Meta:
        model = Camera
        fields = [
            'id', 'name', 'location', 'stream_url', 'direction',
            'is_active', 'min_confidence', 'last_seen_at', 'is_online',
            'created_at',
        ]
        read_only_fields = ['id', 'last_seen_at', 'created_at']

    def get_is_online(self, obj) -> bool:
        from django.utils import timezone
        from datetime import timedelta
        if not obj.last_seen_at:
            return False
        return timezone.now() - obj.last_seen_at < timedelta(minutes=5)

    def validate_min_confidence(self, value):
        if not 0 <= value <= 1:
            raise serializers.ValidationError('Confidence must be between 0 and 1.')
        return value


class RecognitionEventSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_code', read_only=True)
    camera_name = serializers.CharField(source='camera.name', read_only=True)

    class Meta:
        model = RecognitionEvent
        fields = [
            'id', 'camera', 'camera_name', 'employee', 'employee_name',
            'employee_code', 'decision', 'confidence', 'distance',
            'captured_at', 'snapshot', 'message',
        ]
        read_only_fields = fields


class FrameIngestSerializer(serializers.Serializer):
    """Payload a door camera (or edge worker) posts for each frame."""

    image = serializers.ImageField()
    captured_at = serializers.DateTimeField(required=False)


class AttendanceSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_code', read_only=True)
    department_name = serializers.CharField(
        source='employee.department.name', read_only=True
    )

    class Meta:
        model = Attendance
        fields = [
            'id', 'employee', 'employee_name', 'employee_code', 'department_name',
            'date', 'check_in', 'check_out', 'check_in_camera', 'check_out_camera',
            'status', 'source', 'worked_hours', 'late_minutes',
            'early_leave_minutes', 'overtime_hours', 'note', 'created_at',
        ]
        read_only_fields = [
            'id', 'worked_hours', 'late_minutes', 'early_leave_minutes',
            'overtime_hours', 'created_at',
        ]


class ManualAttendanceSerializer(serializers.ModelSerializer):
    """Used by HR to correct a day the camera got wrong."""

    class Meta:
        model = Attendance
        fields = [
            'id', 'employee', 'date', 'check_in', 'check_out', 'status', 'note',
        ]

    def validate(self, attrs):
        check_in = attrs.get('check_in', getattr(self.instance, 'check_in', None))
        check_out = attrs.get('check_out', getattr(self.instance, 'check_out', None))
        if check_in and check_out and check_out <= check_in:
            raise serializers.ValidationError(
                {'check_out': 'Check-out must be after check-in.'}
            )
        return attrs


class LeaveTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaveType
        fields = ['id', 'name', 'annual_quota', 'is_paid']


class LeaveRequestSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    leave_type_name = serializers.CharField(source='leave_type.name', read_only=True)
    days = serializers.IntegerField(read_only=True)

    class Meta:
        model = LeaveRequest
        fields = [
            'id', 'employee', 'employee_name', 'leave_type', 'leave_type_name',
            'start_date', 'end_date', 'days', 'reason', 'status',
            'reviewed_by', 'reviewed_at', 'review_note', 'created_at',
        ]
        read_only_fields = ['id', 'status', 'reviewed_by', 'reviewed_at', 'review_note']

    def validate(self, attrs):
        start = attrs.get('start_date', getattr(self.instance, 'start_date', None))
        end = attrs.get('end_date', getattr(self.instance, 'end_date', None))
        if start and end and end < start:
            raise serializers.ValidationError(
                {'end_date': 'End date cannot be before the start date.'}
            )

        employee = attrs.get('employee', getattr(self.instance, 'employee', None))
        if employee and start and end:
            clash = LeaveRequest.objects.filter(
                employee=employee,
                status__in=[LeaveRequest.Status.PENDING, LeaveRequest.Status.APPROVED],
                start_date__lte=end,
                end_date__gte=start,
            )
            if self.instance:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                raise serializers.ValidationError(
                    'This employee already has a leave request overlapping these dates.'
                )
        return attrs


class LeaveReviewSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=[LeaveRequest.Status.APPROVED, LeaveRequest.Status.REJECTED]
    )
    review_note = serializers.CharField(required=False, allow_blank=True, max_length=255)


class HolidaySerializer(serializers.ModelSerializer):
    class Meta:
        model = Holiday
        fields = ['id', 'name', 'date', 'is_optional']


class RolePermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = RolePermission
        fields = ['id', 'role', 'permission', 'granted']
        read_only_fields = ['id', 'role', 'permission']


class PermissionMatrixUpdateSerializer(serializers.Serializer):
    """One cell of the matrix, as the permissions page sends it."""

    role = serializers.ChoiceField(choices=RolePermission.EDITABLE_ROLES)
    permission = serializers.ChoiceField(choices=RolePermission.Perm.values)
    granted = serializers.BooleanField()


class PermissionMatrixBulkSerializer(serializers.Serializer):
    changes = PermissionMatrixUpdateSerializer(many=True, allow_empty=False)
