import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarDays, Check, Plus, X } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import { DataTable } from '@/components/shared/data-table'
import { EmployeeCell } from '@/components/shared/employee-cell'
import { StatusBadge } from '@/components/shared/status-badge'
import { Pagination } from '@/components/shared/pagination'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDate } from '@/lib/format'
import { useAuth } from '@/features/auth/auth-context'
import { LeaveRequestDialog } from './leave-request-dialog'

export function LeavePage() {
  const { isStaff } = useAuth()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('pending')
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [review, setReview] = useState(null)   // { leave, action }

  const params = { page, status: status === 'all' ? undefined : status }

  const { data, isLoading } = useQuery({
    queryKey: ['leave-requests', params],
    queryFn: async () => (await api.get('/leave-requests/', { params })).data,
    placeholderData: (prev) => prev,
  })

  const reviewMutation = useMutation({
    mutationFn: async ({ leave, action }) =>
      (await api.post(`/leave-requests/${leave.id}/review/`, { status: action })).data,
    onSuccess: (_, { action }) => {
      toast.success(action === 'approved' ? 'Leave approved.' : 'Leave rejected.')
      queryClient.invalidateQueries({ queryKey: ['leave-requests'] })
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setReview(null)
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not review this request.')),
  })

  const columns = [
    ...(isStaff
      ? [{
          key: 'employee', header: 'Employee',
          cell: (r) => <EmployeeCell name={r.employee_name} size="sm" />,
        }]
      : []),
    { key: 'leave_type_name', header: 'Type' },
    {
      key: 'dates', header: 'Dates', className: 'whitespace-nowrap',
      cell: (r) => `${formatDate(r.start_date)} – ${formatDate(r.end_date)}`,
    },
    { key: 'days', header: 'Days', className: 'tabular-nums' },
    {
      key: 'reason', header: 'Reason',
      className: 'hidden lg:table-cell max-w-xs truncate text-muted-foreground',
      headClassName: 'hidden lg:table-cell',
    },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge kind="leave" value={r.status} /> },
    ...(isStaff
      ? [{
          key: 'actions', header: '', className: 'text-right',
          cell: (r) =>
            r.status === 'pending' ? (
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost" size="icon" aria-label="Approve"
                  onClick={() => setReview({ leave: r, action: 'approved' })}
                >
                  <Check className="text-success" />
                </Button>
                <Button
                  variant="ghost" size="icon" aria-label="Reject"
                  onClick={() => setReview({ leave: r, action: 'rejected' })}
                >
                  <X className="text-destructive" />
                </Button>
              </div>
            ) : null,
        }]
      : []),
  ]

  return (
    <>
      <PageHeader
        title="Leave"
        description={
          isStaff
            ? 'Approving leave fills in attendance, so those days are never marked absent.'
            : 'Request time off and track your approvals.'
        }
      >
        <Button onClick={() => setFormOpen(true)}><Plus /> Request leave</Button>
      </PageHeader>

      <Card>
        <CardContent className="p-4 sm:p-5">
          <Tabs value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
            <TabsList>
              <TabsTrigger value="pending">Pending</TabsTrigger>
              <TabsTrigger value="approved">Approved</TabsTrigger>
              <TabsTrigger value="rejected">Rejected</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>

        <DataTable
          columns={columns}
          rows={data?.results ?? []}
          loading={isLoading}
          empty={{
            icon: CalendarDays,
            title: `No ${status === 'all' ? '' : status} requests`,
            description: 'Leave requests appear here once submitted.',
          }}
        />

        <Pagination page={page} count={data?.count} onChange={setPage} />
      </Card>

      <LeaveRequestDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['leave-requests'] })}
      />

      <ConfirmDialog
        open={Boolean(review)}
        onOpenChange={(open) => !open && setReview(null)}
        title={review?.action === 'approved' ? 'Approve this leave?' : 'Reject this leave?'}
        description={
          review?.action === 'approved'
            ? `${review?.leave?.employee_name} will be marked on leave for ${review?.leave?.days} day(s), so the end-of-day sweep will not record them absent.`
            : `${review?.leave?.employee_name}'s request will be rejected.`
        }
        confirmLabel={review?.action === 'approved' ? 'Approve' : 'Reject'}
        destructive={review?.action === 'rejected'}
        loading={reviewMutation.isPending}
        onConfirm={() => reviewMutation.mutate(review)}
      />
    </>
  )
}
