"""Tests for boards, columns and task assignment.

The behaviour that matters is the board's rules -- what a move does to a
card, who may touch which card -- so that carries the coverage.
"""
import datetime as dt

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from app.models import (
    Department, Designation, Employee, RolePermission, Shift,
)
from tasks.models import Board, BoardColumn, Task, TaskActivity

User = get_user_model()


class BoardFixture(TestCase):
    def setUp(self):
        RolePermission.objects.all().delete()
        RolePermission.seed_defaults()

        self.shift = Shift.objects.create(
            name='General', start_time=dt.time(9, 0), end_time=dt.time(18, 0),
        )
        self.department = Department.objects.create(name='Engineering', code='ENG')
        self.designation = Designation.objects.create(
            title='Engineer', department=self.department,
        )
        self.employee = Employee.objects.create(
            employee_code='EMP001', first_name='Ayesha', last_name='Khan',
            email='ayesha@company.com', department=self.department,
            designation=self.designation, shift=self.shift,
        )
        self.board = Board.objects.create(name='Sprint', department=self.department)
        self.board.seed_default_columns()
        self.todo, self.doing, self.done = self.board.columns.order_by('position')


class BoardModelTests(BoardFixture):
    def test_a_new_board_gets_three_columns(self):
        board = Board.objects.create(name='Fresh')
        board.seed_default_columns()
        self.assertEqual(
            list(board.columns.order_by('position').values_list('name', flat=True)),
            ['To do', 'In progress', 'Done'],
        )
        self.assertTrue(board.columns.get(name='Done').is_done_column)

    def test_seeding_twice_does_not_duplicate_columns(self):
        self.board.seed_default_columns()
        self.assertEqual(self.board.columns.count(), 3)

    def test_landing_in_the_done_column_completes_the_task(self):
        task = Task.objects.create(
            board=self.board, column=self.done, title='Ship it',
        )
        task.apply_column_rules()
        task.save()

        self.assertEqual(task.status, Task.Status.DONE)
        self.assertIsNotNone(task.completed_at)

    def test_moving_out_of_done_reopens_the_task(self):
        task = Task.objects.create(board=self.board, column=self.done, title='Ship it')
        task.apply_column_rules()
        task.save()

        task.column = self.doing
        task.apply_column_rules()
        task.save()

        self.assertEqual(task.status, Task.Status.IN_PROGRESS)
        self.assertIsNone(task.completed_at)

    def test_a_working_column_records_when_work_started(self):
        task = Task.objects.create(board=self.board, column=self.todo, title='Later')
        task.apply_column_rules()
        task.save()
        self.assertIsNone(task.started_at)

        task.column = self.doing
        task.apply_column_rules()
        task.save()
        self.assertIsNotNone(task.started_at)

    def test_overdue_only_counts_unfinished_work(self):
        yesterday = timezone.localdate() - dt.timedelta(days=1)
        task = Task.objects.create(
            board=self.board, column=self.todo, title='Late', due_date=yesterday,
        )
        self.assertTrue(task.is_overdue)

        task.status = Task.Status.DONE
        self.assertFalse(task.is_overdue)

    def test_a_column_reports_when_it_is_full(self):
        self.doing.wip_limit = 1
        self.doing.save()
        self.assertFalse(self.doing.is_full)

        Task.objects.create(board=self.board, column=self.doing, title='One')
        self.assertTrue(self.doing.is_full)


class BoardAPITests(APITestCase, BoardFixture):
    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_user(
            username='admin', email='admin@company.com',
            password='adminpass123', role=User.Role.ADMIN,
        )
        self.worker = User.objects.create_user(
            username='worker', email='worker@company.com',
            password='workerpass123', role=User.Role.EMPLOYEE,
        )
        self.employee.user = self.worker
        self.employee.save()

    def auth(self, email, password):
        response = self.client.post(
            '/api/auth/login/', {'email': email, 'password': password}, format='json',
        )
        self.client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {response.json()["access"]}'
        )

    def make_task(self, column=None, **kwargs):
        return Task.objects.create(
            board=self.board, column=column or self.todo,
            title=kwargs.pop('title', 'A card'), **kwargs,
        )

    def test_creating_a_board_seeds_its_columns(self):
        self.auth('admin@company.com', 'adminpass123')
        response = self.client.post('/api/boards/', {'name': 'New board'}, format='json')

        self.assertEqual(response.status_code, 201)
        board = Board.objects.get(id=response.json()['id'])
        self.assertEqual(board.columns.count(), 3)

    def test_board_detail_returns_columns_with_their_cards(self):
        self.make_task(title='First')
        self.make_task(column=self.doing, title='Second')
        self.auth('admin@company.com', 'adminpass123')

        data = self.client.get(f'/api/boards/{self.board.id}/').json()

        self.assertEqual(len(data['columns']), 3)
        titles = {c['name']: [t['title'] for t in c['tasks']] for c in data['columns']}
        self.assertEqual(titles['To do'], ['First'])
        self.assertEqual(titles['In progress'], ['Second'])

    def test_moving_a_card_records_the_move(self):
        task = self.make_task()
        self.auth('admin@company.com', 'adminpass123')

        response = self.client.post(
            f'/api/tasks/{task.id}/move/', {'column': self.doing.id}, format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['column_name'], 'In progress')
        self.assertTrue(
            TaskActivity.objects.filter(task=task, action='moved').exists()
        )

    def test_a_card_lands_where_it_was_dropped(self):
        first = self.make_task(title='First')
        second = self.make_task(title='Second')
        second.position = first.position + 1000
        second.save()
        mover = self.make_task(column=self.doing, title='Mover')

        self.auth('admin@company.com', 'adminpass123')
        self.client.post(
            f'/api/tasks/{mover.id}/move/',
            {'column': self.todo.id, 'position': 1}, format='json',
        )

        order = list(
            Task.objects.filter(column=self.todo).order_by('position')
            .values_list('title', flat=True)
        )
        self.assertEqual(order, ['First', 'Mover', 'Second'])

    def test_a_full_column_refuses_another_card(self):
        self.doing.wip_limit = 1
        self.doing.save()
        self.make_task(column=self.doing, title='Occupant')
        incoming = self.make_task(title='Incoming')

        self.auth('admin@company.com', 'adminpass123')
        response = self.client.post(
            f'/api/tasks/{incoming.id}/move/', {'column': self.doing.id}, format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('limit', str(response.json()).lower())

    def test_reordering_within_a_full_column_is_still_allowed(self):
        """A WIP limit should not freeze the cards already in the column."""
        self.doing.wip_limit = 1
        self.doing.save()
        task = self.make_task(column=self.doing, title='Occupant')

        self.auth('admin@company.com', 'adminpass123')
        response = self.client.post(
            f'/api/tasks/{task.id}/move/',
            {'column': self.doing.id, 'position': 0}, format='json',
        )

        self.assertEqual(response.status_code, 200)

    def test_a_column_from_another_board_is_rejected(self):
        other = Board.objects.create(name='Other')
        other.seed_default_columns()
        task = self.make_task()

        self.auth('admin@company.com', 'adminpass123')
        response = self.client.post(
            f'/api/tasks/{task.id}/move/',
            {'column': other.columns.first().id}, format='json',
        )

        self.assertEqual(response.status_code, 400)

    def test_assigning_records_who_was_added(self):
        task = self.make_task()
        self.auth('admin@company.com', 'adminpass123')

        response = self.client.post(
            f'/api/tasks/{task.id}/assign/',
            {'employees': [self.employee.id]}, format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['assignee_details']), 1)
        self.assertTrue(
            TaskActivity.objects.filter(task=task, action='assigned').exists()
        )

    def test_an_employee_may_move_their_own_card(self):
        task = self.make_task()
        task.assignees.add(self.employee)
        self.auth('worker@company.com', 'workerpass123')

        response = self.client.post(
            f'/api/tasks/{task.id}/move/', {'column': self.doing.id}, format='json',
        )

        self.assertEqual(response.status_code, 200)

    def test_an_employee_may_not_move_somebody_elses_card(self):
        task = self.make_task()
        self.auth('worker@company.com', 'workerpass123')

        response = self.client.post(
            f'/api/tasks/{task.id}/move/', {'column': self.doing.id}, format='json',
        )

        self.assertEqual(response.status_code, 403)

    def test_an_employee_may_not_create_or_assign(self):
        task = self.make_task()
        self.auth('worker@company.com', 'workerpass123')

        created = self.client.post('/api/tasks/', {
            'board': self.board.id, 'column': self.todo.id, 'title': 'Mine',
        }, format='json')
        assigned = self.client.post(
            f'/api/tasks/{task.id}/assign/',
            {'employees': [self.employee.id]}, format='json',
        )

        self.assertEqual(created.status_code, 403)
        self.assertEqual(assigned.status_code, 403)

    def test_the_mine_filter_returns_only_my_cards(self):
        mine = self.make_task(title='Mine')
        mine.assignees.add(self.employee)
        self.make_task(title='Theirs')

        self.auth('worker@company.com', 'workerpass123')
        response = self.client.get('/api/tasks/', {'mine': 'true'})

        self.assertEqual(response.json()['count'], 1)
        self.assertEqual(response.json()['results'][0]['title'], 'Mine')

    def test_a_comment_can_be_posted_without_naming_the_task(self):
        """The task comes from the URL; requiring it in the body 400s."""
        task = self.make_task()
        self.auth('admin@company.com', 'adminpass123')

        response = self.client.post(
            f'/api/tasks/{task.id}/comments/', {'body': 'On it.'}, format='json',
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['body'], 'On it.')

    def test_a_column_holding_cards_cannot_be_deleted(self):
        self.make_task()
        self.auth('admin@company.com', 'adminpass123')

        response = self.client.delete(f'/api/board-columns/{self.todo.id}/')

        self.assertEqual(response.status_code, 400)
        self.assertTrue(BoardColumn.objects.filter(id=self.todo.id).exists())

    def test_reordering_columns_requires_every_column(self):
        self.auth('admin@company.com', 'adminpass123')

        partial = self.client.post(
            f'/api/boards/{self.board.id}/reorder-columns/',
            {'columns': [self.doing.id]}, format='json',
        )
        full = self.client.post(
            f'/api/boards/{self.board.id}/reorder-columns/',
            {'columns': [self.done.id, self.doing.id, self.todo.id]}, format='json',
        )

        self.assertEqual(partial.status_code, 400)
        self.assertEqual(full.status_code, 200)
        self.assertEqual(
            list(self.board.columns.order_by('position').values_list('name', flat=True)),
            ['Done', 'In progress', 'To do'],
        )

    def test_my_summary_counts_the_callers_own_work(self):
        overdue = self.make_task(title='Late')
        overdue.due_date = timezone.localdate() - dt.timedelta(days=2)
        overdue.save()
        overdue.assignees.add(self.employee)

        self.auth('worker@company.com', 'workerpass123')
        data = self.client.get('/api/tasks/my-summary/').json()

        self.assertEqual(data['assigned'], 1)
        self.assertEqual(data['overdue'], 1)
