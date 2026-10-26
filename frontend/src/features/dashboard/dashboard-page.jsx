import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, CalendarCheck, Camera, CheckCircle2, Clock,
  ScanFace, TrendingUp, UserX, Users,
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import { StatCard } from '@/components/shared/stat-card'
import { StatusBadge } from '@/components/shared/status-badge'
import { EmployeeCell } from '@/components/shared/employee-cell'
import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { formatTime, formatHours } from '@/lib/format'
import { useAuth } from '@/features/auth/auth-context'

export function DashboardPage() {
  const { isAdmin } = useAuth()

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get('/dashboard/')).data,
    // The board is a live view of the door, so keep it fresh.
    refetchInterval: 30_000,
  })

  const { data: today, isLoading: todayLoading } = useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: async () => (await api.get('/attendance/today/')).data,
    refetchInterval: 30_000,
  })

  const employees = data?.employees ?? {}
  const stats = data?.today ?? {}
  const cameras = data?.cameras ?? {}

  const enrolmentPercent = employees.active
    ? Math.round((employees.enrolled_faces / employees.active) * 100)
    : 0

  const chartData = (data?.department_breakdown ?? []).map((row) => ({
    name: row.name,
    Present: row.present_today,
    Total: row.employees_count,
  }))

  const recent = (today?.records ?? []).filter((row) => row.check_in).slice(0, 8)

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Live attendance from the door cameras."
      >
        <Button variant="outline" asChild>
          <Link to="/attendance">
            <CalendarCheck /> View attendance
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Present today" value={stats.present ?? 0}
          hint={`of ${employees.active ?? 0} active employees`}
          icon={CheckCircle2} tone="success" loading={isLoading}
        />
        <StatCard
          label="Late arrivals" value={stats.late ?? 0}
          hint="arrived after the grace period"
          icon={Clock} tone="warning" loading={isLoading}
        />
        <StatCard
          label="Not yet arrived" value={stats.not_yet_arrived ?? 0}
          hint="no camera sighting yet"
          icon={UserX} tone="muted" loading={isLoading}
        />
        <StatCard
          label="Attendance rate" value={`${stats.attendance_rate ?? 0}%`}
          hint="present or late, of active staff"
          icon={TrendingUp} tone="info" loading={isLoading}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Attendance by department</CardTitle>
            <CardDescription>Present today against headcount.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : chartData.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="name" tickLine={false} axisLine={false}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                  />
                  <YAxis
                    allowDecimals={false} tickLine={false} axisLine={false}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                  />
                  <Tooltip
                    cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 'var(--radius)',
                      color: 'hsl(var(--popover-foreground))',
                      fontSize: 12,
                    }}
                  />
                  <Legend
                    iconType="circle" iconSize={8}
                    wrapperStyle={{
                      fontSize: 12,
                      paddingTop: 8,
                      color: 'hsl(var(--muted-foreground))',
                    }}
                  />
                  <Bar dataKey="Total" name="Headcount" fill="hsl(var(--muted-foreground) / 0.35)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Present" name="Present today" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={Users} title="No departments yet"
                description="Add departments and employees to see the breakdown."
              />
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Face enrolment</CardTitle>
              <CardDescription>
                Only enrolled employees can be recognised at the door.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <>
                  <div className="flex items-end justify-between">
                    <span className="text-2xl font-semibold tabular-nums">
                      {employees.enrolled_faces ?? 0}
                      <span className="text-base font-normal text-muted-foreground">
                        {' '}/ {employees.active ?? 0}
                      </span>
                    </span>
                    <span className="text-sm font-medium text-muted-foreground tabular-nums">
                      {enrolmentPercent}%
                    </span>
                  </div>
                  <Progress
                    value={enrolmentPercent}
                    indicatorClassName={enrolmentPercent < 60 ? 'bg-warning' : 'bg-success'}
                  />
                  {employees.not_enrolled > 0 && (
                    <div className="flex items-start gap-2 rounded-md bg-warning/10 p-2.5 text-xs text-warning">
                      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                      <span>
                        {employees.not_enrolled} employee
                        {employees.not_enrolled === 1 ? '' : 's'} cannot be
                        recognised yet.
                      </span>
                    </div>
                  )}
                  <Button variant="outline" size="sm" className="w-full" asChild>
                    <Link to="/employees?enrolled=false">
                      <ScanFace /> Enrol faces
                    </Link>
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cameras</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Online now</span>
                      <span className="font-semibold tabular-nums">
                        {cameras.online ?? 0} / {cameras.total ?? 0}
                      </span>
                    </div>
                    {cameras.total > 0 && cameras.online === 0 && (
                      <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
                        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                        <span>No camera has reported in the last 5 minutes.</span>
                      </div>
                    )}
                    <Button variant="outline" size="sm" className="w-full" asChild>
                      <Link to="/cameras"><Camera /> Manage cameras</Link>
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Latest arrivals</CardTitle>
          <CardDescription>Most recent check-ins recorded today.</CardDescription>
        </CardHeader>
        <CardContent>
          {todayLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : recent.length ? (
            <ul className="divide-y divide-border">
              {recent.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-4 py-3">
                  <EmployeeCell
                    name={row.employee_name} code={row.employee_code} size="sm"
                  />
                  <div className="flex items-center gap-3 text-sm">
                    <span className="hidden text-muted-foreground sm:block">
                      {row.department_name}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatTime(row.check_in)}
                      {row.check_out && ` – ${formatTime(row.check_out)}`}
                    </span>
                    {Number(row.worked_hours) > 0 && (
                      <span className="hidden tabular-nums text-muted-foreground md:block">
                        {formatHours(row.worked_hours)}
                      </span>
                    )}
                    <StatusBadge kind="attendance" value={row.status} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={ScanFace} title="Nobody has arrived yet"
              description="Check-ins appear here as the cameras recognise people at the door."
            />
          )}
        </CardContent>
      </Card>
    </>
  )
}
