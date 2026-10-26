import { useAuth } from '@/features/auth/auth-context'
import { DashboardPage } from './dashboard-page'
import { MyDashboard } from './my-dashboard'

/**
 * Picks the dashboard for the signed-in role.
 *
 * `/dashboard/` is staff-only on the backend, so an ordinary employee gets a
 * view built from endpoints they may actually read. Splitting here rather
 * than inside a component keeps each one's hooks unconditional.
 */
export function Dashboard() {
  const { isStaff } = useAuth()
  return isStaff ? <DashboardPage /> : <MyDashboard />
}
