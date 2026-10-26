import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  CalendarDays, CheckCircle2, Clock, ScanFace, AlertTriangle, CalendarCheck,
} from 'lucide-react'
import { api } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import { StatCard } from '@/components/shared/stat-card'
import { StatusBadge } from '@/components/shared/status-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { DataTable } from '@/components/shared/data-table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/features/auth/auth-context'
import { formatDate, formatHours, formatMinutes, formatTime } from '@/lib/format'

/**
 * The dashboard an ordinary employee sees.
 *
 * `/dashboard/` is staff-only on the backend, so this is built entirely from
 * endpoints an employee may read: their own attendance and leave.
 */
export function MyDashboard() {
  const { user } = useAuth()
  const employee = user?.employee
  const employeeId = employee?.id

  const { data, isLoading } = useQuery({
    queryKey: ['employee-attendance', employeeId],
    queryFn: async () => (await api.get(`/employees/${employeeId}/attendance/`)).data,
    enabled: Boolean(employeeId),
  })

  const { data: leave } = useQuery({
    queryKey: ['leave-requests', 'mine'],
    queryFn: async () => (await api.get('/leave-requests/', { params: { page_size: 5 } })).data,
  })

  const summary = data?.summary ?? {}
  const records = data?.records ?? []
  const todayRecord = records.find((r) => r.date === formatDateISO())

  const columns = [
    { key: 'date', header: 'Date', cell: (r) => formatDate(r.date), className: 'tabular-nums' },
    { key: 'check_in', header: 'In', cell: (r) => formatTime(r.check_in), className: 'tabular-nums' },
    { key: 'check_out', header: 'Out', cell: (r) => formatTime(r.check_out), className: 'tabular-nums' },
    { key: 'worked_hours', header: 'Worked', cell: (r) => formatHours(r.worked_hours), className: 'tabular-nums' },
    {
      key: 'late_minutes', header: 'Late',
      className: 'hidden sm:table-cell tabular-nums', headClassName: 'hidden sm:table-cell',
      cell: (r) => (r.late_minutes ? <span className="text-warning">{formatMinutes(r.late_minutes)}</span> : '—'),
    },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge kind="attendance" value={r.status} /> },
  ]

  if (!employeeId) {
    return (
      <>
        <PageHeader title={`Welcome, ${user?.first_name || user?.username || ''}`} />
        <Card>
          <EmptyState
            icon={AlertTriangle}
            title="No employee record linked"
            description="Your account is not linked to an employee record yet, so attendance cannot be shown. Ask HR to link it."
          />
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={`Welcome, ${employee.full_name?.split(' ')[0] ?? ''}`}
        description="Your attendance this month, recorded automatically at the door."
      >
        <Button variant="outline" asChild>
          <Link to="/leave"><CalendarDays /> Request leave</Link>
        </Button>
      </PageHeader>

      {!employee.is_enrolled && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <ScanFace className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Your face is not enrolled yet, so the cameras cannot recognise you
            at the door. Ask HR to enrol you.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Today" icon={CheckCircle2} tone="success" loading={isLoading}
          value={todayRecord ? formatTime(todayRecord.check_in) : 'Not marked'}
          hint={todayRecord ? `Status: ${todayRecord.status.replace('_', ' ')}` : 'No sighting yet today'}
        />
        <StatCard
          label="Present this month" value={summary.present ?? 0}
          icon={CalendarCheck} tone="success" loading={isLoading}
        />
        <StatCard
          label="Late this month" value={summary.late ?? 0}
          icon={Clock} tone="warning" loading={isLoading}
        />
        <StatCard
          label="Hours worked" value={formatHours(summary.total_hours)}
          hint="this month" icon={Clock} tone="info" loading={isLoading}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>My attendance</CardTitle>
          <CardDescription>This month, newest first.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <DataTable
            columns={columns} rows={records} loading={isLoading}
            empty={{
              icon: CalendarCheck,
              title: 'No attendance yet this month',
              description: 'Your record appears once a camera recognises you at the door.',
            }}
          />
        </CardContent>
      </Card>

      {Boolean(leave?.results?.length) && (
        <Card>
          <CardHeader>
            <CardTitle>My leave requests</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {leave.results.map((request) => (
                <li key={request.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{request.leave_type_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatDate(request.start_date)} – {formatDate(request.end_date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="muted">{request.days}d</Badge>
                    <StatusBadge kind="leave" value={request.status} />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  )
}

/** Local YYYY-MM-DD, matching the dates the backend returns. */
function formatDateISO() {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
