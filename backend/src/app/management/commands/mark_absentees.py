"""End-of-day sweep: record every active employee the cameras never saw.

Run from cron just after the last shift ends:
    0 23 * * *  python manage.py mark_absentees
"""
import datetime as dt

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from app.services.attendance import mark_absentees


class Command(BaseCommand):
    help = 'Mark employees with no attendance record for a date as absent.'

    def add_arguments(self, parser):
        parser.add_argument('--date', help='YYYY-MM-DD; defaults to today.')

    def handle(self, *args, **options):
        if options['date']:
            try:
                date = dt.date.fromisoformat(options['date'])
            except ValueError as exc:
                raise CommandError('--date must be in YYYY-MM-DD format.') from exc
        else:
            date = timezone.localdate()

        created = mark_absentees(date)
        self.stdout.write(self.style.SUCCESS(
            f'{date}: marked {created} employee(s) absent.'
        ))
