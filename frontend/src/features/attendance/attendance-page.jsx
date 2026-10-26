import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { CalendarCheck, CheckCircle2, Clock, UserX, Pencil, UserRoundCheck } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import { DataTable } from '@/components/shared/data-table'
import { EmployeeCell } from '@/components/shared/employee-cell'
import { StatusBadge } from '@/components/shared/status-badge'
import { StatCard } from '@/components/shared/stat-card'
import { Pagination } from '@/components/shared/pagination'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ATTENDANCE_STATUS } from '@/lib/constants'
import { formatDate, formatHours, formatMinutes, formatTime, toISODate } from '@/lib/format'
import { useAuth } from '@/features/auth/auth-context'
import { AttendanceEditDialog } from './attendance-edit-dialog'
import { AttendanceGrid } from './attendance-grid'

const ALL = '__all__'

export function AttendancePage() {
  const { isStaff, isHR } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [view, setView] = useState('today')
  // The sweep always targets today; it is the end-of-day job.
  const date = toISODate()
  const [range, setRange] = useState({ start: toISODate(), end: toISODate() })
  const [status, setStatus] = useState(ALL)
  const [department, setDepartment] = useState(ALL)
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState(null)
  const [sweepOpen, setSweepOpen] = useState(false)

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => (await api.get('/departments/', { params: { page_size: 100 } })).data,
    enabled: isStaff,
  })

  /* "Today" uses the dedicated endpoint because it also returns the live
     summary; the history view uses the filtered list. */
  const todayQuery = useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: async () => (await api.get('/attendance/today/')).data,
    enabled: view === 'today',
    refetchInterval: 30_000,
  })

  const historyParams = {
    page,
    start: range.start || undefined,
    end: range.end || undefined,
    status: status === ALL ? undefined : status,
    department: department === ALL ? undefined : department,
  }

  const historyQuery = useQuery({
    queryKey: ['attendance', 'history', historyParams],
    queryFn: async () => (await api.get('/attendance/', { params: historyParams })).data,
    enabled: view === 'history',
    placeholderData: (prev) => prev,
  })

  const sweep = useMutation({
    mutationFn: async () => (await api.post('/attendance/mark-absentees/', { date })).data,
    onSuccess: (data) => {
      toast.success(`${data.absentees_marked} employee(s) marked absent for ${formatDate(data.date)}.`)
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setSweepOpen(false)
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not run the sweep.')),
  })

  const summary = todayQuery.data?.summary ?? {}
  const rows = view === 'today' ? (todayQuery.data?.records ?? []) : (historyQuery.data?.results ?? [])
  const loading = view === 'today' ? todayQuery.isLoading : historyQuery.isLoading

  const columns = [
    {
      key: 'employee', header: 'Employee',
      cell: (r) => <EmployeeCell name={r.employee_name} code={r.employee_code} size="sm" />,
    },
    {
      key: 'department_name', header: 'Department',
      className: 'hidden md:table-cell', headClassName: 'hidden md:table-cell',
    },
    ...(view === 'history'
      ? [{ key: 'date', header: 'Date', cell: (r) => formatDate(r.date), className: 'tabular-nums' }]
      : []),
    { key: 'check_in', header: 'In', cell: (r) => formatTime(r.check_in), className: 'tabular-nums' },
    { key: 'check_out', header: 'Out', cell: (r) => formatTime(r.check_out), className: 'tabular-nums' },
    { key: 'worked_hours', header: 'Worked', cell: (r) => formatHours(r.worked_hours), className: 'tabular-nums' },
    {
      key: 'late_minutes', header: 'Late',
      className: 'hidden lg:table-cell tabular-nums', headClassName: 'hidden lg:table-cell',
      cell: (r) => (r.late_minutes ? <span className="text-warning">{formatMinutes(r.late_minutes)}</span> : '—'),
    },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge kind="attendance" value={r.status} /> },
    ...(isHR
      ? [{
          key: 'actions', header: '', className: 'text-right',
          cell: (r) => (
            <Button
              variant="ghost" size="icon"
              aria-label="Correct this record"
              onClick={() => setEditing(r)}
            >
              <Pencil />
            </Button>
          ),
        }]
      : []),
  ]

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Marked automatically from the door cameras. HR can correct a record the camera got wrong."
      >
        {isHR && (
          <Button variant="outline" onClick={() => setSweepOpen(true)}>
            <UserRoundCheck /> Mark absentees
          </Button>
        )}
      </PageHeader>

      {view === 'today' && isStaff && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Present" value={summary.present ?? 0} icon={CheckCircle2} tone="success" loading={todayQuery.isLoading} />
          <StatCard label="Late" value={summary.late ?? 0} icon={Clock} tone="warning" loading={todayQuery.isLoading} />
          <StatCard label="On leave" value={summary.on_leave ?? 0} icon={CalendarCheck} tone="info" loading={todayQuery.isLoading} />
          <StatCard label="Not yet arrived" value={summary.not_yet_arrived ?? 0} icon={UserX} tone="muted" loading={todayQuery.isLoading} />
        </div>
      )}

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Tabs value={view} onValueChange={(v) => { setView(v); setPage(1) }}>
              <TabsList>
                <TabsTrigger value="today">Today</TabsTrigger>
                <TabsTrigger value="calendar">Calendar</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
            </Tabs>

            {isStaff && view !== 'today' && (
              <Select value={department} onValueChange={(v) => { setDepartment(v); setPage(1) }}>
                <SelectTrigger className="sm:w-48">
                  <SelectValue placeholder="All departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All departments</SelectItem>
                  {(departments?.results ?? []).map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {view === 'history' && (
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="start">From</Label>
                <Input
                  id="start" type="date" className="sm:w-40"
                  value={range.start}
                  onChange={(e) => { setRange((r) => ({ ...r, start: e.target.value })); setPage(1) }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end">To</Label>
                <Input
                  id="end" type="date" className="sm:w-40"
                  value={range.end}
                  onChange={(e) => { setRange((r) => ({ ...r, end: e.target.value })); setPage(1) }}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
                  <SelectTrigger className="sm:w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All statuses</SelectItem>
                    {Object.entries(ATTENDANCE_STATUS).map(([value, { label }]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

            </div>
          )}
        </CardContent>

        {view === 'calendar' ? (
          <div className="p-4 pt-0 sm:p-5 sm:pt-0">
            <AttendanceGrid
              department={department === ALL ? undefined : department}
              onPickEmployee={(employee) => navigate(`/employees/${employee.id}`)}
            />
          </div>
        ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          empty={{
            icon: CalendarCheck,
            title: view === 'today' ? 'Nobody has been marked yet' : 'No records in this range',
            description: view === 'today'
              ? 'Attendance appears here as the cameras recognise people at the door.'
              : 'Try widening the date range or clearing the filters.',
          }}
        />
        )}

        {view === 'history' && (
          <Pagination page={page} count={historyQuery.data?.count} onChange={setPage} />
        )}
      </Card>

      <AttendanceEditDialog
        record={editing}
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['attendance'] })
          queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        }}
      />

      <ConfirmDialog
        open={sweepOpen}
        onOpenChange={setSweepOpen}
        title="Mark absentees"
        description={`Everyone active with no record for ${formatDate(date)} will be marked absent. Holidays and approved leave are recorded as such instead. This is the end-of-day sweep.`}
        confirmLabel="Run sweep"
        loading={sweep.isPending}
        onConfirm={() => sweep.mutate()}
      />
    </>
  )
}
