"""Kanban boards and task assignment.

A board owns its columns, and a task lives in exactly one column. Ordering is
explicit rather than implied by timestamps, because a Kanban board's whole
point is that people arrange cards by hand.
"""
from django.conf import settings
from django.db import models
from django.utils import timezone

from app.models import Department, Employee, TimeStampedModel


class Board(TimeStampedModel):
    """A collection of columns. One per team, project or workflow."""

    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    department = models.ForeignKey(
        Department, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='boards',
        help_text='Optional: scopes the board to one department.',
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='owned_boards',
    )
    is_archived = models.BooleanField(default=False, db_index=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name

    def seed_default_columns(self):
        """Give a new board the usual three columns.

        Called on creation so a board is never an empty page with nowhere to
        put a card.
        """
        if self.columns.exists():
            return []
        defaults = [
            ('To do', 0, False),
            ('In progress', 1, False),
            ('Done', 2, True),
        ]
        return BoardColumn.objects.bulk_create([
            BoardColumn(board=self, name=name, position=pos, is_done_column=done)
            for name, pos, done in defaults
        ])


class BoardColumn(TimeStampedModel):
    """One vertical lane on a board."""

    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name='columns')
    name = models.CharField(max_length=80)
    position = models.PositiveIntegerField(default=0, db_index=True)
    #: Moving a card here completes it, so the task's status and completion
    #: date follow the column rather than needing a separate action.
    is_done_column = models.BooleanField(default=False)
    #: 0 means no limit. A work-in-progress cap is the one Kanban rule most
    #: teams actually use.
    wip_limit = models.PositiveIntegerField(
        default=0, help_text='Maximum cards in this column; 0 means no limit.'
    )
    colour = models.CharField(
        max_length=20, blank=True,
        help_text='Optional accent, e.g. "amber". Cosmetic only.',
    )

    class Meta:
        ordering = ['position', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['board', 'name'], name='unique_column_name_per_board'
            )
        ]

    def __str__(self):
        return f'{self.board.name} / {self.name}'

    @property
    def is_full(self):
        return bool(self.wip_limit) and self.tasks.count() >= self.wip_limit


class Task(TimeStampedModel):
    """A card on a board, optionally assigned to an employee."""

    class Priority(models.TextChoices):
        LOW = 'low', 'Low'
        MEDIUM = 'medium', 'Medium'
        HIGH = 'high', 'High'
        URGENT = 'urgent', 'Urgent'

    class Status(models.TextChoices):
        OPEN = 'open', 'Open'
        IN_PROGRESS = 'in_progress', 'In progress'
        BLOCKED = 'blocked', 'Blocked'
        DONE = 'done', 'Done'
        CANCELLED = 'cancelled', 'Cancelled'

    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name='tasks')
    column = models.ForeignKey(
        BoardColumn, on_delete=models.PROTECT, related_name='tasks'
    )
    #: Rank within the column. Fractional so a card can be dropped between two
    #: others without renumbering the whole column.
    position = models.FloatField(default=0)

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    priority = models.CharField(
        max_length=10, choices=Priority.choices, default=Priority.MEDIUM, db_index=True
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.OPEN, db_index=True
    )

    assignees = models.ManyToManyField(
        Employee, blank=True, related_name='tasks',
        help_text='Who is doing the work. A task may have several owners.',
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='created_tasks',
    )

    due_date = models.DateField(null=True, blank=True, db_index=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    estimated_hours = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True
    )

    labels = models.JSONField(
        default=list, blank=True,
        help_text='Free-form tags, e.g. ["bug", "design"].',
    )

    class Meta:
        ordering = ['column__position', 'position', 'id']
        indexes = [
            models.Index(fields=['board', 'column', 'position']),
            models.Index(fields=['status', 'due_date']),
        ]

    def __str__(self):
        return self.title

    @property
    def is_overdue(self):
        """Overdue only matters while the work is still outstanding."""
        if not self.due_date or self.status in (self.Status.DONE, self.Status.CANCELLED):
            return False
        return self.due_date < timezone.localdate()

    def apply_column_rules(self):
        """Keep status and timestamps in step with the column the card sits in.

        The column is what people manipulate, so it is the source of truth;
        status follows it rather than being set twice by hand.
        """
        if self.column.is_done_column:
            if self.status not in (self.Status.DONE, self.Status.CANCELLED):
                self.status = self.Status.DONE
            self.completed_at = self.completed_at or timezone.now()
        else:
            # Moved back out of Done: it is no longer complete.
            if self.status == self.Status.DONE:
                self.status = self.Status.IN_PROGRESS
            self.completed_at = None
            # The first working column a card reaches is when work began.
            if not self.started_at and self.column.position > 0:
                self.started_at = timezone.now()
                if self.status == self.Status.OPEN:
                    self.status = self.Status.IN_PROGRESS
        return self


class TaskComment(TimeStampedModel):
    """A note on a card. The running conversation about the work."""

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='comments')
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='task_comments',
    )
    body = models.TextField()

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f'Comment on {self.task_id}'


class TaskActivity(TimeStampedModel):
    """An audit trail of what happened to a card.

    Written by the API rather than signals, so each entry can record the
    specific change in words a person can read.
    """

    class Action(models.TextChoices):
        CREATED = 'created', 'Created'
        MOVED = 'moved', 'Moved'
        ASSIGNED = 'assigned', 'Assigned'
        UNASSIGNED = 'unassigned', 'Unassigned'
        UPDATED = 'updated', 'Updated'
        COMMENTED = 'commented', 'Commented'
        COMPLETED = 'completed', 'Completed'
        REOPENED = 'reopened', 'Reopened'

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='activity')
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='task_activity',
    )
    action = models.CharField(max_length=20, choices=Action.choices, db_index=True)
    detail = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name_plural = 'task activity'

    def __str__(self):
        return f'{self.action} on {self.task_id}'
