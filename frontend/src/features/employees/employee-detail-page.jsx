import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Pencil, ScanFace } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/auth-context'
import { ProfileView } from './profile-view'
import { EnrollFaceDialog } from './enroll-face-dialog'
import { EmployeeFormDialog } from './employee-form-dialog'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function EmployeeDetailPage() {
  const { id } = useParams()
  const { isHR } = useAuth()
  const queryClient = useQueryClient()
  const [enrolling, setEnrolling] = useState(false)
  const [editing, setEditing] = useState(false)

  // The dialogs need the full record; ProfileView caches it under the same key.
  const { data: employee } = useQuery({
    queryKey: ['employee', id],
    queryFn: async () => (await api.get(`/employees/${id}/`)).data,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['employee', id] })
    queryClient.invalidateQueries({ queryKey: ['employees'] })
  }

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit">
        <Link to="/employees"><ArrowLeft /> Back to employees</Link>
      </Button>

      <ProfileView
        employeeId={id}
        showSalary={isHR}
        actions={
          isHR && (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
              <Button onClick={() => setEnrolling(true)}>
                <ScanFace /> Enrol face
              </Button>
            </>
          )
        }
      />

      <EnrollFaceDialog
        employee={employee}
        open={enrolling}
        onOpenChange={setEnrolling}
        onEnrolled={refresh}
      />

      <EmployeeFormDialog
        open={editing}
        onOpenChange={setEditing}
        employee={employee}
        onSaved={refresh}
      />
    </>
  )
}
