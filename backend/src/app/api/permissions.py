"""Role-based permissions and camera device authentication."""
from __future__ import annotations

from django.utils import timezone
from rest_framework import authentication, exceptions, permissions

from app.models import Camera, RolePermission


class IsAdmin(permissions.BasePermission):
    message = 'Admin role required.'

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role == user.Role.ADMIN)


class IsHROrAdmin(permissions.BasePermission):
    """Roles allowed to create and edit employee records."""

    message = 'HR or Admin role required.'

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        return user.role in {user.Role.ADMIN, user.Role.HR}


class IsStaffLevel(permissions.BasePermission):
    """Admin, HR or Manager -- anyone who may view other people's data."""

    message = 'Manager, HR or Admin role required.'

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_staff_level)


class ReadOnlyForEmployees(permissions.BasePermission):
    """Everyone authenticated may read; only staff-level roles may write."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return user.is_staff_level


class CameraDevice:
    """A non-user principal: the camera itself.

    DRF expects `request.user` to answer `is_authenticated`, but a camera must
    never pass a permission class written for people. It reports as
    authenticated, carries the Camera, and is rejected by every role check
    above because it has no `role`.
    """

    is_authenticated = True
    is_anonymous = False
    is_staff_level = False

    def __init__(self, camera: Camera):
        self.camera = camera

    def __str__(self):
        return f'camera:{self.camera.name}'


class CameraAPIKeyAuthentication(authentication.BaseAuthentication):
    """Authenticates a camera from its `X-Camera-Key` header.

    Cameras sit on the network with no human to log in, so they carry a
    long-lived per-device key instead of a JWT. The key is scoped to one
    camera and can be rotated from the admin without touching the others.
    """

    keyword = 'X-Camera-Key'

    def authenticate(self, request):
        key = request.headers.get(self.keyword)
        if not key:
            return None

        camera = Camera.objects.filter(api_key=key).first()
        if camera is None:
            raise exceptions.AuthenticationFailed('Unknown camera key.')
        if not camera.is_active:
            raise exceptions.AuthenticationFailed('This camera is disabled.')

        return (CameraDevice(camera), camera)

    def authenticate_header(self, request):
        return self.keyword


class IsCameraDevice(permissions.BasePermission):
    message = 'A valid camera key is required.'

    def has_permission(self, request, view):
        return isinstance(request.user, CameraDevice)


class HasPermission(permissions.BasePermission):
    """Checks one entry from the editable role matrix.

    Used as `HasPermission.of('manage_employees')`. This is the real control:
    hiding a link in the UI is cosmetic, but a request without the permission
    is refused here regardless of what the client renders.
    """

    permission = None
    message = 'Your role does not have permission for this action.'

    @classmethod
    def of(cls, permission, message=None):
        """Build a permission class bound to one entry."""
        label = permission.replace('_', ' ')
        return type(
            f'HasPermission_{permission}',
            (cls,),
            {
                'permission': permission,
                'message': message or f'Your role is not allowed to {label}.',
            },
        )

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        # A camera device is not a person and holds no role permissions.
        if isinstance(user, CameraDevice):
            return False
        return self.permission in RolePermission.granted_for(user.role)


class ReadOrPermission(permissions.BasePermission):
    """Anyone authenticated may read; writing needs the named permission."""

    permission = None

    @classmethod
    def of(cls, permission):
        return type(
            f'ReadOrPermission_{permission}',
            (cls,),
            {'permission': permission,
             'message': f'Your role is not allowed to {permission.replace("_", " ")}.'},
        )

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        if isinstance(user, CameraDevice):
            return False
        return self.permission in RolePermission.granted_for(user.role)
