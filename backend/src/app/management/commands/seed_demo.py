"""Create a usable starting dataset: admin login, departments, shifts, leave
types and a few employees. Idempotent -- safe to re-run."""
import datetime as dt

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from app.models import Department, Designation, Employee, LeaveType, Shift

User = get_user_model()


class Command(BaseCommand):
    help = 'Seed departments, shifts, leave types, an admin user and demo employees.'

    def add_arguments(self, parser):
        parser.add_argument('--password', default='admin12345',
                            help='Password for the seeded admin account.')

    @transaction.atomic
    def handle(self, *args, **options):
        password = options['password']

        admin, created = User.objects.get_or_create(
            email='admin@company.com',
            defaults={'username': 'admin', 'role': User.Role.ADMIN,
                      'is_staff': True, 'is_superuser': True},
        )
        if created:
            admin.set_password(password)
            admin.save()
            self.stdout.write(self.style.SUCCESS(
                f'Admin created: admin@company.com / {password}'
            ))
        else:
            self.stdout.write('Admin already exists.')

        shifts = {}
        for name, start, end, grace in [
            ('General', dt.time(9, 0), dt.time(18, 0), 15),
            ('Morning', dt.time(6, 0), dt.time(14, 0), 10),
            ('Night', dt.time(22, 0), dt.time(6, 0), 15),
        ]:
            shifts[name], _ = Shift.objects.get_or_create(
                name=name,
                defaults={'start_time': start, 'end_time': end, 'grace_minutes': grace},
            )

        departments = {}
        for name, code in [
            ('Engineering', 'ENG'), ('Human Resources', 'HR'),
            ('Sales', 'SLS'), ('Operations', 'OPS'),
        ]:
            departments[code], _ = Department.objects.get_or_create(
                name=name, defaults={'code': code}
            )

        designations = {}
        for title, code in [
            ('Software Engineer', 'ENG'), ('Senior Software Engineer', 'ENG'),
            ('HR Officer', 'HR'), ('Sales Executive', 'SLS'),
            ('Operations Manager', 'OPS'),
        ]:
            designations[title], _ = Designation.objects.get_or_create(
                title=title, defaults={'department': departments[code]}
            )

        for name, quota, paid in [
            ('Annual Leave', 20, True), ('Sick Leave', 10, True),
            ('Casual Leave', 10, True), ('Unpaid Leave', 0, False),
        ]:
            LeaveType.objects.get_or_create(
                name=name, defaults={'annual_quota': quota, 'is_paid': paid}
            )

        demo = [
            ('EMP001', 'Ayesha', 'Khan', 'ayesha.khan@company.com', 'ENG', 'Software Engineer'),
            ('EMP002', 'Bilal', 'Ahmed', 'bilal.ahmed@company.com', 'ENG', 'Senior Software Engineer'),
            ('EMP003', 'Sara', 'Malik', 'sara.malik@company.com', 'HR', 'HR Officer'),
            ('EMP004', 'Usman', 'Raza', 'usman.raza@company.com', 'SLS', 'Sales Executive'),
        ]
        for code, first, last, email, dept, title in demo:
            Employee.objects.get_or_create(
                employee_code=code,
                defaults={
                    'first_name': first, 'last_name': last, 'email': email,
                    'department': departments[dept],
                    'designation': designations[title],
                    'shift': shifts['General'],
                },
            )

        self.stdout.write(self.style.SUCCESS(
            f'Seeded {Department.objects.count()} departments, '
            f'{Shift.objects.count()} shifts, {Employee.objects.count()} employees.'
        ))
