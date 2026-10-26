from django.contrib import admin

from tasks.models import Board, BoardColumn, Task, TaskActivity, TaskComment


class BoardColumnInline(admin.TabularInline):
    model = BoardColumn
    extra = 0
    fields = ['name', 'position', 'is_done_column', 'wip_limit', 'colour']


@admin.register(Board)
class BoardAdmin(admin.ModelAdmin):
    list_display = ['name', 'department', 'owner', 'is_archived']
    list_filter = ['is_archived', 'department']
    search_fields = ['name']
    inlines = [BoardColumnInline]


@admin.register(BoardColumn)
class BoardColumnAdmin(admin.ModelAdmin):
    list_display = ['name', 'board', 'position', 'is_done_column', 'wip_limit']
    list_filter = ['board', 'is_done_column']


class TaskCommentInline(admin.TabularInline):
    model = TaskComment
    extra = 0
    readonly_fields = ['author', 'created_at']


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ['title', 'board', 'column', 'status', 'priority', 'due_date']
    list_filter = ['board', 'status', 'priority']
    search_fields = ['title', 'description']
    filter_horizontal = ['assignees']
    inlines = [TaskCommentInline]
    date_hierarchy = 'created_at'


@admin.register(TaskActivity)
class TaskActivityAdmin(admin.ModelAdmin):
    list_display = ['created_at', 'task', 'action', 'actor', 'detail']
    list_filter = ['action']
    readonly_fields = [f.name for f in TaskActivity._meta.fields]
