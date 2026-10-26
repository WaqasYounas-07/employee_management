"""Domain models for the employee management & camera attendance system."""
import uuid

from django.conf import settings
from django.contrib.auth.models import AbstractUser, UserManager
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models
from django.utils import timezone


class TimeStampedModel(models.Model):
    """Adds created/updated bookkeeping to every concrete model."""

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class EmployeeUserManager(UserManager):
    """Keeps `role` in step with Django's own superuser flag.

    `createsuperuser` knows nothing about the `role` field, so without this a
    new superuser would be saved with the model default (`employee`) and the
    API and UI -- which gate on `role`, not on `is_superuser` -- would treat
    them as an ordinary employee.
    """

    def create_superuser(self, username=None, email=None, password=None, **extra_fields):
        extra_fields.setdefault('role', self.model.Role.ADMIN)
        return super().create_superuser(username, email, password, **extra_fields)


class User(AbstractUser):
    """Login account. Separate from Employee: not every employee needs a login."""

    class Role(models.TextChoices):
        ADMIN = 'admin', 'Admin'
        HR = 'hr', 'HR'
        MANAGER = 'manager', 'Manager'
        EMPLOYEE = 'employee', 'Employee'

    email = models.EmailField(unique=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.EMPLOYEE)
    phone = models.CharField(max_length=30, blank=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']

    objects = EmployeeUserManager()

    def __str__(self):
        return f'{self.email} ({self.role})'

    def save(self, *args, **kwargs):
        """A superuser is always an admin.

        The manager covers `createsuperuser`; this covers a superuser promoted
        in the admin, a shell or a data migration, so the flag and the role can
        never disagree.
        """
        if self.is_superuser and self.role != self.Role.ADMIN:
            self.role = self.Role.ADMIN
            update_fields = kwargs.get('update_fields')
            if update_fields is not None:
                kwargs['update_fields'] = set(update_fields) | {'role'}
        super().save(*args, **kwargs)

    @property
    def is_staff_level(self):
        """True for roles allowed to manage other people's records."""
        return self.role in {self.Role.ADMIN, self.Role.HR, self.Role.MANAGER}


class Department(TimeStampedModel):
    name = models.CharField(max_length=120, unique=True)
    code = models.CharField(max_length=20, unique=True)
    description = models.TextField(blank=True)

    def __str__(self):
        return self.name


class Designation(TimeStampedModel):
    title = models.CharField(max_length=120, unique=True)
    department = models.ForeignKey(
        Department, on_delete=models.CASCADE, related_name='designations'
    )

    def __str__(self):
        return self.title


class Shift(TimeStampedModel):
    """Working window used to decide late arrival and early departure."""

    name = models.CharField(max_length=80, unique=True)
    start_time = models.TimeField()
    end_time = models.TimeField()
    grace_minutes = models.PositiveIntegerField(
        default=15, help_text='Minutes after start_time still counted as on time.'
    )
    half_day_hours = models.DecimalField(
        max_digits=4, decimal_places=2, default=4,
        help_text='Worked hours below this mark the day as half day.',
    )
    full_day_hours = models.DecimalField(max_digits=4, decimal_places=2, default=8)

    def __str__(self):
        return f'{self.name} ({self.start_time}-{self.end_time})'

    @property
    def is_overnight(self):
        return self.end_time <= self.start_time


class Employee(TimeStampedModel):
    class Status(models.TextChoices):
        ACTIVE = 'active', 'Active'
        PROBATION = 'probation', 'Probation'
        SUSPENDED = 'suspended', 'Suspended'
        TERMINATED = 'terminated', 'Terminated'

    class EmploymentType(models.TextChoices):
        FULL_TIME = 'full_time', 'Full time'
        PART_TIME = 'part_time', 'Part time'
        CONTRACT = 'contract', 'Contract'
        INTERN = 'intern', 'Intern'

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='employee',
    )
    employee_code = models.CharField(max_length=30, unique=True, db_index=True)
    first_name = models.CharField(max_length=80)
    last_name = models.CharField(max_length=80)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=30, blank=True)
    cnic = models.CharField(
        max_length=20, blank=True, help_text='National ID number.'
    )
    date_of_birth = models.DateField(null=True, blank=True)
    address = models.TextField(blank=True)

    department = models.ForeignKey(
        Department, on_delete=models.PROTECT, related_name='employees'
    )
    designation = models.ForeignKey(
        Designation, on_delete=models.PROTECT, related_name='employees'
    )
    shift = models.ForeignKey(
        Shift, on_delete=models.PROTECT, related_name='employees'
    )
    manager = models.ForeignKey(
        'self', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='reports',
    )

    employment_type = models.CharField(
        max_length=20, choices=EmploymentType.choices, default=EmploymentType.FULL_TIME
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.ACTIVE, db_index=True
    )
    date_joined = models.DateField(default=timezone.localdate)
    date_left = models.DateField(null=True, blank=True)
    salary = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    photo = models.ImageField(upload_to='employees/photos/', null=True, blank=True)

    class Meta:
        ordering = ['employee_code']
        indexes = [models.Index(fields=['status', 'department'])]

    def __str__(self):
        return f'{self.employee_code} - {self.full_name}'

    @property
    def full_name(self):
        return f'{self.first_name} {self.last_name}'.strip()

    @property
    def is_enrolled(self):
        """Whether this employee has at least one active face template."""
        return self.face_templates.filter(is_active=True).exists()


class FaceTemplate(TimeStampedModel):
    """One enrolled face encoding for an employee.

    Several per employee is normal and desirable: different angles and
    lighting conditions raise the match rate at the door.
    """

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name='face_templates'
    )
    embedding = models.JSONField(
        help_text='Face descriptor vector produced by the recognition engine.'
    )
    engine = models.CharField(
        max_length=50,
        help_text='Engine that produced the embedding; templates only match within an engine.',
    )
    dimensions = models.PositiveIntegerField()
    source_image = models.ImageField(
        upload_to='employees/faces/', null=True, blank=True
    )
    quality_score = models.FloatField(
        default=0.0, validators=[MinValueValidator(0.0), MaxValueValidator(1.0)]
    )
    is_active = models.BooleanField(default=True, db_index=True)
    enrolled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='enrolled_templates',
    )

    class Meta:
        indexes = [models.Index(fields=['engine', 'is_active'])]

    def __str__(self):
        return f'Face<{self.employee.employee_code} #{self.pk}>'


class Camera(TimeStampedModel):
    """A physical camera at a door or gate."""

    class Direction(models.TextChoices):
        IN = 'in', 'Entry only'
        OUT = 'out', 'Exit only'
        BOTH = 'both', 'Entry and exit'

    name = models.CharField(max_length=120, unique=True)
    location = models.CharField(max_length=200, help_text='Main gate, 2nd floor lobby, ...')
    stream_url = models.CharField(
        max_length=500, blank=True,
        help_text='RTSP/HTTP stream the edge worker reads from.',
    )
    direction = models.CharField(
        max_length=10, choices=Direction.choices, default=Direction.BOTH
    )
    api_key = models.CharField(max_length=64, unique=True, db_index=True, blank=True)
    is_active = models.BooleanField(default=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    min_confidence = models.FloatField(
        default=0.60,
        help_text='Override of the global threshold for this camera.',
    )

    def __str__(self):
        return f'{self.name} @ {self.location}'

    def save(self, *args, **kwargs):
        if not self.api_key:
            self.api_key = uuid.uuid4().hex
        super().save(*args, **kwargs)

    def touch(self):
        """Record that the camera reported in, without a full save."""
        self.last_seen_at = timezone.now()
        self.save(update_fields=['last_seen_at', 'updated_at'])


class RecognitionEvent(TimeStampedModel):
    """Raw audit record of every frame the camera submitted.

    Kept even when no employee matched, so false negatives at the door can be
    investigated later.
    """

    class Decision(models.TextChoices):
        MATCHED = 'matched', 'Matched'
        NO_MATCH = 'no_match', 'No match'
        LOW_CONFIDENCE = 'low_confidence', 'Below threshold'
        NO_FACE = 'no_face', 'No face detected'
        DUPLICATE = 'duplicate', 'Ignored as duplicate'
        ERROR = 'error', 'Processing error'

    camera = models.ForeignKey(
        Camera, on_delete=models.CASCADE, related_name='events'
    )
    employee = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='recognition_events',
    )
    matched_template = models.ForeignKey(
        FaceTemplate, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='events',
    )
    decision = models.CharField(
        max_length=20, choices=Decision.choices, db_index=True
    )
    confidence = models.FloatField(default=0.0)
    distance = models.FloatField(
        null=True, blank=True, help_text='Raw engine distance; lower is closer.'
    )
    captured_at = models.DateTimeField(default=timezone.now, db_index=True)
    snapshot = models.ImageField(upload_to='events/%Y/%m/%d/', null=True, blank=True)
    message = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ['-captured_at']
        indexes = [
            models.Index(fields=['employee', 'captured_at']),
            models.Index(fields=['camera', 'captured_at']),
        ]

    def __str__(self):
        who = self.employee.employee_code if self.employee else 'unknown'
        return f'{self.decision}:{who}@{self.captured_at:%Y-%m-%d %H:%M:%S}'


class Attendance(TimeStampedModel):
    """One row per employee per working day, built from recognition events."""

    class Status(models.TextChoices):
        PRESENT = 'present', 'Present'
        LATE = 'late', 'Late'
        HALF_DAY = 'half_day', 'Half day'
        ABSENT = 'absent', 'Absent'
        ON_LEAVE = 'on_leave', 'On leave'
        HOLIDAY = 'holiday', 'Holiday'

    class Source(models.TextChoices):
        CAMERA = 'camera', 'Camera'
        MANUAL = 'manual', 'Manual entry'
        IMPORT = 'import', 'Imported'

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name='attendance'
    )
    date = models.DateField(db_index=True)
    check_in = models.DateTimeField(null=True, blank=True)
    check_out = models.DateTimeField(null=True, blank=True)
    check_in_camera = models.ForeignKey(
        Camera, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='check_ins',
    )
    check_out_camera = models.ForeignKey(
        Camera, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='check_outs',
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PRESENT, db_index=True
    )
    source = models.CharField(
        max_length=20, choices=Source.choices, default=Source.CAMERA
    )
    worked_hours = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    late_minutes = models.PositiveIntegerField(default=0)
    early_leave_minutes = models.PositiveIntegerField(default=0)
    overtime_hours = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    note = models.CharField(max_length=255, blank=True)
    marked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='marked_attendance',
    )

    class Meta:
        ordering = ['-date', 'employee__employee_code']
        constraints = [
            models.UniqueConstraint(
                fields=['employee', 'date'], name='unique_attendance_per_day'
            )
        ]
        indexes = [models.Index(fields=['date', 'status'])]

    def __str__(self):
        return f'{self.employee.employee_code} {self.date} {self.status}'


class LeaveType(TimeStampedModel):
    name = models.CharField(max_length=80, unique=True)
    annual_quota = models.PositiveIntegerField(default=0)
    is_paid = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class LeaveRequest(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'
        CANCELLED = 'cancelled', 'Cancelled'

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name='leave_requests'
    )
    leave_type = models.ForeignKey(
        LeaveType, on_delete=models.PROTECT, related_name='requests'
    )
    start_date = models.DateField()
    end_date = models.DateField()
    reason = models.TextField(blank=True)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='reviewed_leaves',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ['-start_date']

    def __str__(self):
        return f'{self.employee.employee_code} {self.start_date}->{self.end_date} ({self.status})'

    @property
    def days(self):
        return (self.end_date - self.start_date).days + 1


class Holiday(TimeStampedModel):
    name = models.CharField(max_length=120)
    date = models.DateField(unique=True, db_index=True)
    is_optional = models.BooleanField(default=False)

    class Meta:
        ordering = ['date']

    def __str__(self):
        return f'{self.date} {self.name}'


class RolePermission(TimeStampedModel):
    """What a role may do, as editable data rather than hardcoded rules.

    One row per (role, permission). A missing row means "not granted", so the
    defaults in `DEFAULT_MATRIX` are seeded on first use and an admin edits
    from there.

    The admin role is deliberately not editable: locking every admin out of
    the permissions page would leave nobody able to put it right.
    """

    class Perm(models.TextChoices):
        # Pages -- these drive the sidebar and the route guards.
        VIEW_DASHBOARD = 'view_dashboard', 'View dashboard'
        VIEW_EMPLOYEES = 'view_employees', 'View employees'
        VIEW_ATTENDANCE = 'view_attendance', 'View attendance'
        VIEW_LEAVE = 'view_leave', 'View leave'
        VIEW_CAMERAS = 'view_cameras', 'View cameras'
        VIEW_RECOGNITION_LOG = 'view_recognition_log', 'View recognition log'
        VIEW_SETTINGS = 'view_settings', 'View settings'
        VIEW_PERMISSIONS = 'view_permissions', 'View permissions'
        VIEW_REPORTS = 'view_reports', 'View reports'
        VIEW_TASKS = 'view_tasks', 'View task boards'

        # Actions within those pages.
        MANAGE_EMPLOYEES = 'manage_employees', 'Add and edit employees'
        ENROL_FACES = 'enrol_faces', 'Enrol employee faces'
        CORRECT_ATTENDANCE = 'correct_attendance', 'Correct attendance records'
        MANAGE_CAMERAS = 'manage_cameras', 'Add and edit cameras'
        APPROVE_LEAVE = 'approve_leave', 'Approve or reject leave'
        MANAGE_SETTINGS = 'manage_settings', 'Change organisation settings'
        MANAGE_PERMISSIONS = 'manage_permissions', 'Change role permissions'
        MANAGE_USERS = 'manage_users', 'Manage login accounts'
        MANAGE_BOARDS = 'manage_boards', 'Create and edit boards'
        MANAGE_TASKS = 'manage_tasks', 'Create, edit and move any task'
        ASSIGN_TASKS = 'assign_tasks', 'Assign tasks to employees'

    #: Which permissions each role starts with. Mirrors the rules the system
    #: shipped with, so seeding changes nothing for an existing install.
    DEFAULT_MATRIX = {
        'hr': [
            Perm.VIEW_DASHBOARD, Perm.VIEW_EMPLOYEES, Perm.VIEW_ATTENDANCE,
            Perm.VIEW_LEAVE, Perm.VIEW_RECOGNITION_LOG, Perm.VIEW_SETTINGS,
            Perm.VIEW_REPORTS, Perm.MANAGE_EMPLOYEES, Perm.ENROL_FACES,
            Perm.CORRECT_ATTENDANCE, Perm.APPROVE_LEAVE, Perm.MANAGE_SETTINGS,
            Perm.VIEW_TASKS, Perm.MANAGE_BOARDS, Perm.MANAGE_TASKS,
            Perm.ASSIGN_TASKS,
        ],
        'manager': [
            Perm.VIEW_DASHBOARD, Perm.VIEW_EMPLOYEES, Perm.VIEW_ATTENDANCE,
            Perm.VIEW_LEAVE, Perm.VIEW_RECOGNITION_LOG, Perm.VIEW_REPORTS,
            Perm.APPROVE_LEAVE,
            Perm.VIEW_TASKS, Perm.MANAGE_BOARDS, Perm.MANAGE_TASKS,
            Perm.ASSIGN_TASKS,
        ],
        'employee': [
            Perm.VIEW_DASHBOARD, Perm.VIEW_EMPLOYEES, Perm.VIEW_ATTENDANCE,
            Perm.VIEW_LEAVE, Perm.VIEW_TASKS,
        ],
    }

    #: Roles an admin may edit. `admin` is absent on purpose.
    EDITABLE_ROLES = ['hr', 'manager', 'employee']

    role = models.CharField(max_length=20, choices=User.Role.choices, db_index=True)
    permission = models.CharField(max_length=40, choices=Perm.choices)
    granted = models.BooleanField(default=False)

    class Meta:
        ordering = ['role', 'permission']
        constraints = [
            models.UniqueConstraint(
                fields=['role', 'permission'], name='unique_role_permission'
            )
        ]

    def __str__(self):
        state = 'granted' if self.granted else 'denied'
        return f'{self.role}:{self.permission} ({state})'

    @classmethod
    def seed_defaults(cls):
        """Create any missing rows from `DEFAULT_MATRIX`.

        Only fills gaps -- an existing row is never overwritten, so seeding
        again does not undo an admin's edits.
        """
        existing = set(cls.objects.values_list('role', 'permission'))
        rows = [
            cls(role=role, permission=perm, granted=perm in defaults)
            for role, defaults in cls.DEFAULT_MATRIX.items()
            for perm in cls.Perm.values
            if (role, perm) not in existing
        ]
        if rows:
            cls.objects.bulk_create(rows, ignore_conflicts=True)
        return len(rows)

    @classmethod
    def granted_for(cls, role):
        """The permission names a role currently holds.

        An admin holds everything, always: the matrix cannot be used to lock
        admins out of the page that edits it.
        """
        if role == User.Role.ADMIN:
            return set(cls.Perm.values)
        cls.seed_defaults()
        return set(
            cls.objects.filter(role=role, granted=True)
            .values_list('permission', flat=True)
        )
