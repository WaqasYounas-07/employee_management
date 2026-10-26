"""Task and board routes, mounted under /api/."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from tasks.api import views

router = DefaultRouter()
router.register('boards', views.BoardViewSet, basename='board')
router.register('board-columns', views.BoardColumnViewSet, basename='boardcolumn')
router.register('tasks', views.TaskViewSet, basename='task')

urlpatterns = [path('', include(router.urls))]
