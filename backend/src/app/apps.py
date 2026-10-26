from django.apps import AppConfig


class EmployeeAppConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'app'
    verbose_name = 'Employee Management'

    def ready(self):
        from app import signals  # noqa: F401
