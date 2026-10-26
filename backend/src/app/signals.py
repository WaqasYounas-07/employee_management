"""Keep the cached face-template set in step with the database.

Enrollment invalidates the cache directly, but templates can also change via
the admin or a shell, so the signals are the backstop.
"""
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from app.models import Employee, FaceTemplate
from app.services.enrollment import invalidate_template_cache


@receiver([post_save, post_delete], sender=FaceTemplate)
def _template_changed(sender, **kwargs):
    invalidate_template_cache()


@receiver(post_save, sender=Employee)
def _employee_changed(sender, instance, **kwargs):
    """A suspended or terminated employee must stop matching at the door, and
    the cached set filters on status."""
    invalidate_template_cache()
