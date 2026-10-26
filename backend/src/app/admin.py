from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from app.models import (
    Attendance, Camera, Department, Designation, Employee, FaceTemplate,
    Holiday, LeaveRequest, LeaveType, RecognitionEvent, Shift, User,
)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ['email', 'username', 'role', 'is_active', 'is_superuser']
    list_filter = ['role', 'is_active', 'is_superuser']
    search_fields = ['email', 'username', 'first_name', 'last_name']
    ordering = ['email']
    fieldsets = BaseUserAdmin.fieldsets + (
        ('Role', {'fields': ('role', 'phone')}),
    )
    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        ('Role', {'fields': ('email', 'role', 'phone')}),
    )


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ['name', 'code']
    search_fields = ['name', 'code']


@admin.register(Designation)
class DesignationAdmin(admin.ModelAdmin):
    list_display = ['title', 'department']
    list_filter = ['department']


@admin.register(Shift)
class ShiftAdmin(admin.ModelAdmin):
    list_display = ['name', 'start_time', 'end_time', 'grace_minutes', 'full_day_hours']


class FaceTemplateInline(admin.TabularInline):
    model = FaceTemplate
    extra = 0
    fields = ['engine', 'dimensions', 'quality_score', 'is_active', 'created_at']
    readonly_fields = ['engine', 'dimensions', 'quality_score', 'created_at']


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = [
        'employee_code', 'full_name', 'department', 'designation',
        'status', 'is_enrolled',
    ]
    list_filter = ['status', 'department', 'employment_type', 'shift']
    search_fields = ['employee_code', 'first_name', 'last_name', 'email']
    inlines = [FaceTemplateInline]
    autocomplete_fields = ['manager']
    raw_id_fields = ['user']

    @admin.display(boolean=True, description='Face enrolled')
    def is_enrolled(self, obj):
        return obj.is_enrolled


@admin.register(Camera)
class CameraAdmin(admin.ModelAdmin):
    list_display = ['name', 'location', 'direction', 'is_active', 'last_seen_at']
    list_filter = ['direction', 'is_active']
    readonly_fields = ['api_key', 'last_seen_at']


@admin.register(RecognitionEvent)
class RecognitionEventAdmin(admin.ModelAdmin):
    list_display = ['captured_at', 'camera', 'employee', 'decision', 'confidence']
    list_filter = ['decision', 'camera']
    search_fields = ['employee__employee_code', 'employee__first_name']
    date_hierarchy = 'captured_at'
    readonly_fields = [f.name for f in RecognitionEvent._meta.fields]


@admin.register(Attendance)
class AttendanceAdmin(admin.ModelAdmin):
    list_display = [
        'date', 'employee', 'status', 'check_in', 'check_out',
        'worked_hours', 'late_minutes',
    ]
    list_filter = ['status', 'source', 'employee__department']
    search_fields = ['employee__employee_code', 'employee__first_name']
    date_hierarchy = 'date'


@admin.register(LeaveType)
class LeaveTypeAdmin(admin.ModelAdmin):
    list_display = ['name', 'annual_quota', 'is_paid']


@admin.register(LeaveRequest)
class LeaveRequestAdmin(admin.ModelAdmin):
    list_display = ['employee', 'leave_type', 'start_date', 'end_date', 'status']
    list_filter = ['status', 'leave_type']


@admin.register(Holiday)
class HolidayAdmin(admin.ModelAdmin):
    list_display = ['date', 'name', 'is_optional']
