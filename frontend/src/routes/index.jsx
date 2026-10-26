import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AppShell } from '@/components/layout/app-shell'
import { RequireAuth, RequirePermission } from './guards'
import { LoginPage } from '@/features/auth/login-page'

/* Routes are split so the first paint does not carry the charting library or
   pages this user may never open. */
const Dashboard = lazy(() =>
  import('@/features/dashboard').then((m) => ({ default: m.Dashboard })))
const EmployeesPage = lazy(() =>
  import('@/features/employees/employees-page').then((m) => ({ default: m.EmployeesPage })))
const EmployeeDetailPage = lazy(() =>
  import('@/features/employees/employee-detail-page').then((m) => ({ default: m.EmployeeDetailPage })))
const MyProfilePage = lazy(() =>
  import('@/features/employees/my-profile-page').then((m) => ({ default: m.MyProfilePage })))
const BoardsPage = lazy(() =>
  import('@/features/boards/boards-page').then((m) => ({ default: m.BoardsPage })))
const BoardPage = lazy(() =>
  import('@/features/boards/board-page').then((m) => ({ default: m.BoardPage })))
const MyTasksPage = lazy(() =>
  import('@/features/boards/my-tasks-page').then((m) => ({ default: m.MyTasksPage })))
const AttendancePage = lazy(() =>
  import('@/features/attendance/attendance-page').then((m) => ({ default: m.AttendancePage })))
const KioskPage = lazy(() =>
  import('@/features/kiosk/kiosk-page').then((m) => ({ default: m.KioskPage })))
const CamerasPage = lazy(() =>
  import('@/features/cameras/cameras-page').then((m) => ({ default: m.CamerasPage })))
const RecognitionEventsPage = lazy(() =>
  import('@/features/cameras/recognition-events-page').then((m) => ({ default: m.RecognitionEventsPage })))
const LeavePage = lazy(() =>
  import('@/features/leave/leave-page').then((m) => ({ default: m.LeavePage })))
const PermissionsPage = lazy(() =>
  import('@/features/permissions/permissions-page').then((m) => ({ default: m.PermissionsPage })))
const SettingsPage = lazy(() =>
  import('@/features/settings/settings-page').then((m) => ({ default: m.SettingsPage })))

function RouteFallback() {
  return (
    <div className="flex min-h-64 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  )
}

/** Wraps a lazy page in the shared loading fallback. */
const page = (element) => <Suspense fallback={<RouteFallback />}>{element}</Suspense>

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: page(<Dashboard />) },
      { path: 'employees', element: page(<EmployeesPage />) },
      { path: 'employees/:id', element: page(<EmployeeDetailPage />) },
      { path: 'my-profile', element: page(<MyProfilePage />) },
      { path: 'attendance', element: page(<AttendancePage />) },
      { path: 'leave', element: page(<LeavePage />) },
      {
        path: 'boards',
        element: <RequirePermission permission="view_tasks">{page(<BoardsPage />)}</RequirePermission>,
      },
      {
        path: 'my-tasks',
        element: <RequirePermission permission="view_tasks">{page(<MyTasksPage />)}</RequirePermission>,
      },
      {
        path: 'boards/:id',
        element: <RequirePermission permission="view_tasks">{page(<BoardPage />)}</RequirePermission>,
      },
      {
        path: 'cameras',
        element: <RequirePermission permission="view_cameras">{page(<CamerasPage />)}</RequirePermission>,
      },
      {
        path: 'live',
        element: <RequirePermission permission="view_cameras">{page(<KioskPage />)}</RequirePermission>,
      },
      {
        path: 'recognition-events',
        element: (
          <RequirePermission permission="view_recognition_log">
            {page(<RecognitionEventsPage />)}
          </RequirePermission>
        ),
      },
      {
        path: 'permissions',
        element: <RequirePermission permission="view_permissions">{page(<PermissionsPage />)}</RequirePermission>,
      },
      {
        path: 'settings',
        element: <RequirePermission permission="view_settings">{page(<SettingsPage />)}</RequirePermission>,
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
