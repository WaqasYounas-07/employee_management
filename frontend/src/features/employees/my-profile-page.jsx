import { AlertTriangle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/empty-state'
import { PageHeader } from '@/components/shared/page-header'
import { useAuth } from '@/features/auth/auth-context'
import { ProfileView } from './profile-view'

/** The signed-in user's own profile, whatever their role. */
export function MyProfilePage() {
  const { user } = useAuth()
  const employeeId = user?.employee?.id

  if (!employeeId) {
    return (
      <>
        <PageHeader title="My profile" />
        <Card>
          <EmptyState
            icon={AlertTriangle}
            title="No employee record linked"
            description="Your login is not linked to an employee record, so there is no profile to show. Ask HR to link it."
          />
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="My profile"
        description="Your details as HR holds them. Ask HR to correct anything that is wrong."
      />
      <ProfileView employeeId={employeeId} showSalary />
    </>
  )
}
