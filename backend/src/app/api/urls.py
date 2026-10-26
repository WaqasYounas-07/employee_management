"""API routing. Everything is mounted under /api/."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView, TokenVerifyView

from app.api import views

router = DefaultRouter()
router.register('users', views.UserViewSet, basename='user')
router.register('departments', views.DepartmentViewSet, basename='department')
router.register('designations', views.DesignationViewSet, basename='designation')
router.register('shifts', views.ShiftViewSet, basename='shift')
router.register('holidays', views.HolidayViewSet, basename='holiday')
router.register('employees', views.EmployeeViewSet, basename='employee')
router.register('face-templates', views.FaceTemplateViewSet, basename='facetemplate')
router.register('cameras', views.CameraViewSet, basename='camera')
router.register('recognition-events', views.RecognitionEventViewSet, basename='recognitionevent')
router.register('attendance', views.AttendanceViewSet, basename='attendance')
router.register('leave-types', views.LeaveTypeViewSet, basename='leavetype')
router.register('leave-requests', views.LeaveRequestViewSet, basename='leaverequest')

urlpatterns = [
    # Auth
    path('auth/login/', TokenObtainPairView.as_view(), name='login'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('auth/verify/', TokenVerifyView.as_view(), name='token_verify'),
    path('auth/register/', views.RegisterView.as_view(), name='register'),
    path('auth/me/', views.MeView.as_view(), name='me'),
    path('auth/change-password/', views.ChangePasswordView.as_view(), name='change_password'),

    # Camera ingestion -- declared before the router so it is not shadowed by
    # the camera detail route.
    path('cameras/ingest/', views.FrameIngestView.as_view(), name='camera_ingest'),

    # Role permissions
    path('permissions/', views.PermissionMatrixView.as_view(), name='permissions'),

    # Reporting
    path('dashboard/', views.DashboardView.as_view(), name='dashboard'),
    path('reports/attendance/', views.AttendanceReportView.as_view(), name='attendance_report'),

    # Boards and tasks live in their own app.
    path('', include('tasks.api.urls')),

    path('', include(router.urls)),
]
