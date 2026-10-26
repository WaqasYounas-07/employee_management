import { useQuery } from '@tanstack/react-query'
import {
  BadgeCheck, Briefcase, Building2, CalendarDays, Clock, Mail, MapPin,
  Phone, ScanFace, UserRound, CreditCard, CheckCircle2, CalendarCheck,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { StatusBadge } from '@/components/shared/status-badge'
import { DataTable } from '@/components/shared/data-table'
import { StatCard } from '@/components/shared/stat-card'
import { EMPLOYMENT_TYPE } from '@/lib/constants'
import {
  formatDate, formatHours, formatMinutes, formatTime, initials,
} from '@/lib/format'
import { cn } from '@/lib/utils'

function Detail({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="break-words text-sm font-medium">{value || '—'}</p>
      </div>
    </div>
  )
}

function Section({ title, children, className }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/**
 * The employee profile. Shared by the HR-facing detail route and the
 * employee's own "My profile", which differ only in whose id they load and
 * what actions they offer.
 */
export function ProfileView({ employeeId, actions, showSalary = false }) {
  const { data: employee, isLoading } = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: async () => (await api.get(`/employees/${employeeId}/`)).data,
    enabled: Boolean(employeeId),
  })

  const { data: attendance, isLoading: attendanceLoading } = useQuery({
    queryKey: ['employee-attendance', employeeId],
    queryFn: async () => (await api.get(`/employees/${employeeId}/attendance/`)).data,
    enabled: Boolean(employeeId),
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-56 w-full rounded-xl" />
        <div className="grid min-w-0 gap-6 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    )
  }

  if (!employee) {
    return <p className="text-sm text-muted-foreground">Employee not found.</p>
  }

  const summary = attendance?.summary ?? {}
  const records = attendance?.records ?? []
  const active = employee.status === 'active'

  const columns = [
    { key: 'date', header: 'Date', cell: (r) => formatDate(r.date), className: 'tabular-nums' },
    { key: 'check_in', header: 'In', cell: (r) => formatTime(r.check_in), className: 'tabular-nums' },
    { key: 'check_out', header: 'Out', cell: (r) => formatTime(r.check_out), className: 'tabular-nums' },
    { key: 'worked_hours', header: 'Worked', cell: (r) => formatHours(r.worked_hours), className: 'tabular-nums' },
    {
      key: 'late_minutes', header: 'Late',
      className: 'hidden sm:table-cell tabular-nums', headClassName: 'hidden sm:table-cell',
      cell: (r) => (r.late_minutes
        ? <span className="text-warning">{formatMinutes(r.late_minutes)}</span>
        : '—'),
    },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge kind="attendance" value={r.status} /> },
  ]

  return (
    <div className="space-y-6">
      {/* Header: cover band with the avatar overlapping it. */}
      <Card className="overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-primary/15 via-info/10 to-success/10 sm:h-24" />
        <CardContent className="pt-0">
          <div className="-mt-10 flex flex-col gap-4 pb-1 sm:-mt-12 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="relative w-fit">
                <Avatar className="h-24 w-24 border-4 border-card shadow-sm sm:h-28 sm:w-28">
                  {employee.photo && <AvatarImage src={employee.photo} alt="" />}
                  <AvatarFallback className="text-2xl">
                    {initials(employee.full_name)}
                  </AvatarFallback>
                </Avatar>
                {/* The badge means "enrolled for face recognition", the one
                    thing that decides whether the door can recognise them. */}
                {employee.is_enrolled && (
                  <span
                    title="Face enrolled"
                    className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-card bg-primary"
                  >
                    <BadgeCheck className="h-4 w-4 text-primary-foreground" />
                  </span>
                )}
              </div>

              <div className="min-w-0 space-y-1.5 pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight">
                    {employee.full_name}
                  </h1>
                  <span
                    className={cn(
                      'h-2.5 w-2.5 rounded-full',
                      active ? 'bg-success' : 'bg-muted-foreground',
                    )}
                    title={active ? 'Active' : employee.status}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  {employee.designation_title} at {employee.department_name}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <Badge tone="outline">{employee.employee_code}</Badge>
                  <StatusBadge kind="employee" value={employee.status} />
                  {employee.is_enrolled ? (
                    <Badge tone="success">Face enrolled</Badge>
                  ) : (
                    <Badge tone="warning">Not enrolled</Badge>
                  )}
                </div>
              </div>
            </div>

            {actions && <div className="flex flex-wrap gap-2 pb-1">{actions}</div>}
          </div>
        </CardContent>
      </Card>

      {!employee.is_enrolled && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <ScanFace className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            No face enrolled, so the door cameras cannot recognise{' '}
            {employee.first_name} and attendance must be entered by hand.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Present" value={summary.present ?? 0} hint="this month"
          icon={CheckCircle2} tone="success" loading={attendanceLoading}
        />
        <StatCard
          label="Late" value={summary.late ?? 0} hint="this month"
          icon={Clock} tone="warning" loading={attendanceLoading}
        />
        <StatCard
          label="Absent" value={summary.absent ?? 0} hint="this month"
          icon={CalendarCheck} tone="destructive" loading={attendanceLoading}
        />
        <StatCard
          label="Hours worked" value={formatHours(summary.total_hours)} hint="this month"
          icon={Clock} tone="info" loading={attendanceLoading}
        />
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Section title="About">
            <div className="grid gap-5 sm:grid-cols-2">
              <Detail icon={Mail} label="Email" value={employee.email} />
              <Detail icon={Phone} label="Phone" value={employee.phone} />
              <Detail
                icon={CalendarDays} label="Date of birth"
                value={employee.date_of_birth ? formatDate(employee.date_of_birth) : '—'}
              />
              <Detail icon={CreditCard} label="CNIC / National ID" value={employee.cnic} />
              <div className="sm:col-span-2">
                <Detail icon={MapPin} label="Address" value={employee.address} />
              </div>
            </div>
          </Section>

          <Section title="Employment">
            <div className="grid gap-5 sm:grid-cols-2">
              <Detail icon={Building2} label="Department" value={employee.department_name} />
              <Detail icon={Briefcase} label="Designation" value={employee.designation_title} />
              <Detail
                icon={Briefcase} label="Employment type"
                value={EMPLOYMENT_TYPE[employee.employment_type]}
              />
              <Detail icon={Clock} label="Shift" value={employee.shift_name} />
              <Detail icon={CalendarDays} label="Joined" value={formatDate(employee.date_joined)} />
              <Detail icon={UserRound} label="Reports to" value={employee.manager_name} />
              {employee.date_left && (
                <Detail icon={CalendarDays} label="Left" value={formatDate(employee.date_left)} />
              )}
              {/* Salary is sensitive: shown only where the caller asked for it. */}
              {showSalary && (
                <Detail
                  icon={CreditCard} label="Salary"
                  value={Number(employee.salary).toLocaleString()}
                />
              )}
            </div>
          </Section>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Attendance this month</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <DataTable
                columns={columns} rows={records} loading={attendanceLoading}
                empty={{
                  icon: CalendarCheck,
                  title: 'No attendance this month',
                  description: 'Records appear once a camera recognises them at the door.',
                }}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Section title="Face recognition">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Templates on file</span>
                <Badge tone={employee.is_enrolled ? 'success' : 'muted'}>
                  {employee.face_templates?.filter((t) => t.is_active).length ?? 0}
                </Badge>
              </div>
              <Separator />
              {employee.face_templates?.length ? (
                <ul className="grid grid-cols-3 gap-2">
                  {employee.face_templates
                    .filter((t) => t.is_active)
                    .slice(0, 6)
                    .map((template) => (
                      <li key={template.id} className="space-y-1">
                        {template.source_image ? (
                          <img
                            src={template.source_image} alt=""
                            className="aspect-square w-full rounded-md object-cover"
                          />
                        ) : (
                          <div className="flex aspect-square w-full items-center justify-center rounded-md bg-muted">
                            <ScanFace className="h-5 w-5 text-muted-foreground" />
                          </div>
                        )}
                        <p className="text-center text-[10px] text-muted-foreground tabular-nums">
                          {(template.quality_score * 100).toFixed(0)}%
                        </p>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No face enrolled yet.
                </p>
              )}
            </div>
          </Section>

          <Section title="At a glance">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">On leave</dt>
                <dd className="font-medium tabular-nums">{summary.on_leave ?? 0} days</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Half days</dt>
                <dd className="font-medium tabular-nums">{summary.half_day ?? 0}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Overtime</dt>
                <dd className="font-medium tabular-nums">
                  {formatHours(summary.total_overtime)}
                </dd>
              </div>
              <Separator />
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Login account</dt>
                <dd className="font-medium">{employee.user ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
          </Section>
        </div>
      </div>
    </div>
  )
}
