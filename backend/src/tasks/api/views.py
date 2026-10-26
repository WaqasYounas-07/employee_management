"""Board and task endpoints.

Access follows the same role permission matrix as the rest of the system:
`view_tasks` to see boards, `manage_boards` to shape them, `manage_tasks` to
edit anyone's card, `assign_tasks` to hand work out.

On top of that, somebody assigned to a card may move, update and comment on
it without holding `manage_tasks` -- otherwise an ordinary employee could see
their work on a board but never move it, which defeats the point.
"""
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from app.api.permissions import HasPermission
from app.models import Employee, RolePermission
from tasks.api import serializers as s
from tasks.models import Board, BoardColumn, Task, TaskActivity, TaskComment

#: Gap between adjacent cards. Leaving room between ranks means a drop
#: between two cards is a midpoint, not a renumbering of the column.
POSITION_STEP = 1000.0


def _can(user, permission):
    return permission in RolePermission.granted_for(user.role)


def _own_employee(user):
    return getattr(user, 'employee', None)


def log(task, user, action_name, detail=''):
    TaskActivity.objects.create(
        task=task, actor=user, action=action_name, detail=detail[:255]
    )


class BoardViewSet(viewsets.ModelViewSet):
    """Boards. Reading needs `view_tasks`; changing one needs `manage_boards`."""

    serializer_class = s.BoardSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description']
    ordering_fields = ['name', 'created_at']

    def get_permissions(self):
        if self.action in {'create', 'update', 'partial_update', 'destroy',
                           'add_column', 'reorder_columns'}:
            return [HasPermission.of('manage_boards')()]
        return [HasPermission.of('view_tasks')()]

    def get_queryset(self):
        qs = Board.objects.select_related('department').annotate(
            column_count=Count('columns', distinct=True),
            task_count=Count('tasks', distinct=True),
        ).order_by('name', 'id')
        params = self.request.query_params
        if params.get('archived') == 'true':
            qs = qs.filter(is_archived=True)
        elif params.get('archived') != 'all':
            qs = qs.filter(is_archived=False)
        if department := params.get('department'):
            qs = qs.filter(department_id=department)
        return qs

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return s.BoardDetailSerializer
        return s.BoardSerializer

    def perform_create(self, serializer):
        board = serializer.save(owner=self.request.user)
        # A board with no columns has nowhere to put a card.
        board.seed_default_columns()

    def retrieve(self, request, *args, **kwargs):
        """The whole board: columns in order, each with its cards."""
        board = self.get_object()
        columns = list(
            board.columns.annotate(task_count=Count('tasks')).order_by('position', 'id')
        )
        tasks = list(
            Task.objects.filter(board=board)
            .select_related('column', 'board')
            .prefetch_related('assignees')
            .annotate(comment_count=Count('comments', distinct=True))
            .order_by('position', 'id')
        )

        # Filters narrow the cards without changing the column layout.
        params = request.query_params
        if assignee := params.get('assignee'):
            tasks = [t for t in tasks if any(a.id == int(assignee) for a in t.assignees.all())]
        if priority := params.get('priority'):
            tasks = [t for t in tasks if t.priority == priority]
        if search := params.get('search'):
            needle = search.lower()
            tasks = [t for t in tasks if needle in t.title.lower()]

        serializer = self.get_serializer(
            board, context={**self.get_serializer_context(), 'columns': columns, 'tasks': tasks},
        )
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='columns')
    def add_column(self, request, pk=None):
        board = self.get_object()
        serializer = s.BoardColumnSerializer(data={**request.data, 'board': board.id})
        serializer.is_valid(raise_exception=True)
        last = board.columns.order_by('-position').first()
        serializer.save(board=board, position=(last.position + 1) if last else 0)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='reorder-columns')
    def reorder_columns(self, request, pk=None):
        """Persist a new left-to-right column order."""
        board = self.get_object()
        ids = request.data.get('columns')
        if not isinstance(ids, list) or not ids:
            raise ValidationError({'columns': 'Expected a list of column ids.'})

        owned = set(board.columns.values_list('id', flat=True))
        if set(ids) != owned:
            raise ValidationError(
                {'columns': 'The list must contain every column on this board exactly once.'}
            )

        with transaction.atomic():
            for index, column_id in enumerate(ids):
                BoardColumn.objects.filter(id=column_id).update(position=index)
        return Response({'detail': 'Column order saved.'})


class BoardColumnViewSet(viewsets.ModelViewSet):
    """Columns. Shaping a board needs `manage_boards`."""

    serializer_class = s.BoardColumnSerializer

    def get_permissions(self):
        if self.request.method in ('GET', 'HEAD', 'OPTIONS'):
            return [HasPermission.of('view_tasks')()]
        return [HasPermission.of('manage_boards')()]

    def get_queryset(self):
        qs = BoardColumn.objects.select_related('board').annotate(task_count=Count('tasks'))
        if board := self.request.query_params.get('board'):
            qs = qs.filter(board_id=board)
        return qs

    def perform_destroy(self, instance):
        # PROTECT on Task.column would raise a database error; say why instead.
        if instance.tasks.exists():
            raise ValidationError(
                'Move or delete this column\'s cards before deleting the column.'
            )
        super().perform_destroy(instance)


class TaskViewSet(viewsets.ModelViewSet):
    """Cards.

    `manage_tasks` covers every card. Without it, a user may still act on a
    card they are assigned to -- moving it, updating it, commenting -- but not
    on anyone else's.
    """

    serializer_class = s.TaskSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['title', 'description']
    ordering_fields = ['due_date', 'priority', 'created_at', 'position']

    def get_permissions(self):
        return [HasPermission.of('view_tasks')()]

    def get_queryset(self):
        qs = (
            Task.objects.select_related('board', 'column')
            .prefetch_related('assignees')
            .annotate(comment_count=Count('comments', distinct=True))
            .order_by('column__position', 'position', 'id')
        )
        params = self.request.query_params
        if board := params.get('board'):
            qs = qs.filter(board_id=board)
        if column := params.get('column'):
            qs = qs.filter(column_id=column)
        if status_value := params.get('status'):
            qs = qs.filter(status=status_value)
        if priority := params.get('priority'):
            qs = qs.filter(priority=priority)
        if params.get('mine') == 'true':
            employee = _own_employee(self.request.user)
            qs = qs.filter(assignees=employee) if employee else qs.none()
        elif assignee := params.get('assignee'):
            qs = qs.filter(assignees__id=assignee)
        if params.get('overdue') == 'true':
            qs = qs.filter(
                due_date__lt=timezone.localdate(),
            ).exclude(status__in=[Task.Status.DONE, Task.Status.CANCELLED])
        return qs.distinct()

    def _assert_may_edit(self, task):
        """Either `manage_tasks`, or it is your own card."""
        user = self.request.user
        if _can(user, 'manage_tasks'):
            return
        employee = _own_employee(user)
        if employee and task.assignees.filter(id=employee.id).exists():
            return
        raise PermissionDenied(
            'You can only change tasks assigned to you, unless your role may '
            'manage all tasks.'
        )

    @transaction.atomic
    def perform_create(self, serializer):
        if not _can(self.request.user, 'manage_tasks'):
            raise PermissionDenied('Your role is not allowed to create tasks.')

        column = serializer.validated_data['column']
        # New cards go to the bottom of their column.
        last = Task.objects.filter(column=column).order_by('-position').first()
        position = (last.position + POSITION_STEP) if last else POSITION_STEP

        assignees = serializer.validated_data.get('assignees')
        if assignees and not _can(self.request.user, 'assign_tasks'):
            raise PermissionDenied('Your role is not allowed to assign tasks.')

        task = serializer.save(created_by=self.request.user, position=position)
        task.apply_column_rules()
        task.save()
        log(task, self.request.user, TaskActivity.Action.CREATED, task.title)

    @transaction.atomic
    def perform_update(self, serializer):
        task = self.get_object()
        self._assert_may_edit(task)

        if 'assignees' in serializer.validated_data and not _can(self.request.user, 'assign_tasks'):
            raise PermissionDenied('Your role is not allowed to assign tasks.')

        before_status = task.status
        task = serializer.save()
        task.apply_column_rules()
        task.save()

        if task.status != before_status:
            if task.status == Task.Status.DONE:
                log(task, self.request.user, TaskActivity.Action.COMPLETED)
            elif before_status == Task.Status.DONE:
                log(task, self.request.user, TaskActivity.Action.REOPENED)
            else:
                log(task, self.request.user, TaskActivity.Action.UPDATED,
                    f'Status set to {task.get_status_display()}.')
        else:
            log(task, self.request.user, TaskActivity.Action.UPDATED)

    def perform_destroy(self, instance):
        if not _can(self.request.user, 'manage_tasks'):
            raise PermissionDenied('Your role is not allowed to delete tasks.')
        super().perform_destroy(instance)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def move(self, request, pk=None):
        """Drop a card into a column at a given index.

        Ranks are spaced out, so a drop between two cards is their midpoint
        and no other card has to be rewritten.
        """
        task = self.get_object()
        self._assert_may_edit(task)

        serializer = s.TaskMoveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        column = serializer.validated_data['column']
        index = serializer.validated_data.get('position')

        if column.board_id != task.board_id:
            raise ValidationError({'column': 'That column belongs to a different board.'})

        # A WIP limit only blocks cards arriving from elsewhere.
        if column.id != task.column_id and column.is_full:
            raise ValidationError({
                'column': f'"{column.name}" is at its limit of {column.wip_limit} cards.'
            })

        siblings = list(
            Task.objects.filter(column=column).exclude(id=task.id).order_by('position')
        )
        if index is None or index >= len(siblings):
            above = siblings[-1].position if siblings else 0.0
            new_position = above + POSITION_STEP
        elif index <= 0:
            new_position = siblings[0].position - POSITION_STEP
        else:
            new_position = (siblings[index - 1].position + siblings[index].position) / 2

        from_column = task.column.name
        task.column = column
        task.position = new_position
        task.apply_column_rules()
        task.save()

        if from_column != column.name:
            log(task, request.user, TaskActivity.Action.MOVED,
                f'{from_column} -> {column.name}')

        return Response(s.TaskSerializer(task, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def assign(self, request, pk=None):
        """Replace a card's assignees."""
        task = self.get_object()
        if not _can(request.user, 'assign_tasks'):
            raise PermissionDenied('Your role is not allowed to assign tasks.')

        serializer = s.TaskAssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        employees = serializer.validated_data['employees']

        before = set(task.assignees.values_list('id', flat=True))
        task.assignees.set(employees)
        after = {e.id for e in employees}

        added = [e for e in employees if e.id not in before]
        removed = Employee.objects.filter(id__in=before - after)
        if added:
            log(task, request.user, TaskActivity.Action.ASSIGNED,
                ', '.join(e.full_name for e in added))
        if removed:
            log(task, request.user, TaskActivity.Action.UNASSIGNED,
                ', '.join(e.full_name for e in removed))

        return Response(s.TaskSerializer(task, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['get', 'post'])
    def comments(self, request, pk=None):
        task = self.get_object()
        if request.method == 'GET':
            return Response(
                s.TaskCommentSerializer(task.comments.all(), many=True).data
            )

        serializer = s.TaskCommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = serializer.save(task=task, author=request.user)
        log(task, request.user, TaskActivity.Action.COMMENTED)
        return Response(
            s.TaskCommentSerializer(comment).data, status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=['get'])
    def activity(self, request, pk=None):
        task = self.get_object()
        return Response(
            s.TaskActivitySerializer(task.activity.all()[:50], many=True).data
        )

    @action(detail=False, methods=['get'], url_path='my-summary')
    def my_summary(self, request):
        """Counts for the signed-in user's own cards, for the dashboard."""
        employee = _own_employee(request.user)
        if not employee:
            return Response({
                'assigned': 0, 'open': 0, 'in_progress': 0, 'overdue': 0, 'done': 0,
            })

        mine = Task.objects.filter(assignees=employee)
        today = timezone.localdate()
        return Response({
            'assigned': mine.count(),
            'open': mine.filter(status=Task.Status.OPEN).count(),
            'in_progress': mine.filter(status=Task.Status.IN_PROGRESS).count(),
            'done': mine.filter(status=Task.Status.DONE).count(),
            'overdue': mine.filter(due_date__lt=today).exclude(
                status__in=[Task.Status.DONE, Task.Status.CANCELLED]
            ).count(),
        })
