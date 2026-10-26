"""Serializers for boards, columns and tasks."""
from django.contrib.auth import get_user_model
from rest_framework import serializers

from app.models import Employee
from tasks.models import Board, BoardColumn, Task, TaskActivity, TaskComment

User = get_user_model()


class TaskAssigneeSerializer(serializers.ModelSerializer):
    """The slice of an employee a card needs: enough to draw an avatar."""

    name = serializers.CharField(source='full_name', read_only=True)

    class Meta:
        model = Employee
        fields = ['id', 'employee_code', 'name', 'photo']
        read_only_fields = fields


class TaskCommentSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = TaskComment
        fields = ['id', 'task', 'author', 'author_name', 'body', 'created_at']
        read_only_fields = ['id', 'task', 'author', 'author_name', 'created_at']

    def get_author_name(self, obj) -> str:
        if not obj.author:
            return 'Removed user'
        full = f'{obj.author.first_name} {obj.author.last_name}'.strip()
        return full or obj.author.username or obj.author.email


class TaskActivitySerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = TaskActivity
        fields = ['id', 'action', 'detail', 'actor', 'actor_name', 'created_at']
        read_only_fields = fields

    def get_actor_name(self, obj) -> str:
        if not obj.actor:
            return 'System'
        full = f'{obj.actor.first_name} {obj.actor.last_name}'.strip()
        return full or obj.actor.username or obj.actor.email


class TaskSerializer(serializers.ModelSerializer):
    """A card. Writes take ids; reads expose the nested names the board draws."""

    assignee_details = TaskAssigneeSerializer(
        source='assignees', many=True, read_only=True
    )
    column_name = serializers.CharField(source='column.name', read_only=True)
    board_name = serializers.CharField(source='board.name', read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    comment_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Task
        fields = [
            'id', 'board', 'board_name', 'column', 'column_name', 'position',
            'title', 'description', 'priority', 'status',
            'assignees', 'assignee_details',
            'created_by', 'due_date', 'started_at', 'completed_at',
            'estimated_hours', 'labels', 'is_overdue', 'comment_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'created_by', 'completed_at', 'created_at', 'updated_at',
        ]

    def validate(self, attrs):
        board = attrs.get('board') or getattr(self.instance, 'board', None)
        column = attrs.get('column') or getattr(self.instance, 'column', None)
        if board and column and column.board_id != board.id:
            raise serializers.ValidationError(
                {'column': 'That column belongs to a different board.'}
            )

        labels = attrs.get('labels')
        if labels is not None:
            if not isinstance(labels, list) or any(not isinstance(x, str) for x in labels):
                raise serializers.ValidationError(
                    {'labels': 'Labels must be a list of strings.'}
                )
            attrs['labels'] = [x.strip() for x in labels if x.strip()][:10]
        return attrs


class TaskMoveSerializer(serializers.Serializer):
    """A drag-and-drop: which column, and where among its cards."""

    column = serializers.PrimaryKeyRelatedField(queryset=BoardColumn.objects.all())
    #: Index among the column's existing cards; the view turns it into a rank.
    position = serializers.IntegerField(min_value=0, required=False)


class TaskAssignSerializer(serializers.Serializer):
    employees = serializers.PrimaryKeyRelatedField(
        queryset=Employee.objects.all(), many=True, allow_empty=True,
    )


class BoardColumnSerializer(serializers.ModelSerializer):
    task_count = serializers.IntegerField(read_only=True)
    is_full = serializers.BooleanField(read_only=True)

    class Meta:
        model = BoardColumn
        fields = [
            'id', 'board', 'name', 'position', 'is_done_column',
            'wip_limit', 'colour', 'task_count', 'is_full',
        ]
        read_only_fields = ['id', 'task_count', 'is_full']


class BoardSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)
    column_count = serializers.IntegerField(read_only=True)
    task_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Board
        fields = [
            'id', 'name', 'description', 'department', 'department_name',
            'owner', 'is_archived', 'column_count', 'task_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'owner', 'created_at', 'updated_at']


class BoardDetailSerializer(BoardSerializer):
    """The whole board in one response: columns, each with its cards.

    A board is useless one page at a time, so this is deliberately not
    paginated -- the client needs every card to lay the columns out.
    """

    columns = serializers.SerializerMethodField()

    class Meta(BoardSerializer.Meta):
        fields = BoardSerializer.Meta.fields + ['columns']

    def get_columns(self, board):
        tasks_by_column = {}
        for task in self.context.get('tasks', []):
            tasks_by_column.setdefault(task.column_id, []).append(task)

        return [
            {
                **BoardColumnSerializer(column).data,
                'tasks': TaskSerializer(
                    tasks_by_column.get(column.id, []), many=True,
                    context=self.context,
                ).data,
            }
            for column in self.context.get('columns', [])
        ]
