import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { Plus, Search, ScanFace, Users, Pencil } from 'lucide-react'
import { api } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import { DataTable } from '@/components/shared/data-table'
import { EmployeeCell } from '@/components/shared/employee-cell'
import { StatusBadge } from '@/components/shared/status-badge'
import { Pagination } from '@/components/shared/pagination'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useDebounce } from '@/hooks/use-debounce'
import { useAuth } from '@/features/auth/auth-context'
import { EMPLOYEE_STATUS } from '@/lib/constants'
import { formatDate } from '@/lib/format'
import { EmployeeFormDialog } from './employee-form-dialog'
import { EnrollFaceDialog } from './enroll-face-dialog'

const ALL = '__all__'

export function EmployeesPage() {
  const { isHR } = useAuth()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [page, setPage] = useState(1)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [enrolling, setEnrolling] = useState(null)

  const status = params.get('status') ?? ALL
  const department = params.get('department') ?? ALL
  const enrolled = params.get('enrolled') ?? ALL

  const setParam = (key, value) => {
    const next = new URLSearchParams(params)
    if (value === ALL) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
    setPage(1)
  }

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => (await api.get('/departments/', { params: { page_size: 100 } })).data,
  })

  const query = {
    page,
    search: debouncedSearch || undefined,
    status: status === ALL ? undefined : status,
    department: department === ALL ? undefined : department,
    enrolled: enrolled === ALL ? undefined : enrolled,
  }

  const { data, isLoading } = useQuery({
    queryKey: ['employees', query],
    queryFn: async () => (await api.get('/employees/', { params: query })).data,
    placeholderData: (prev) => prev,
  })

  const rows = data?.results ?? []

  const columns = [
    {
      key: 'employee',
      header: 'Employee',
      cell: (row) => (
        <EmployeeCell name={row.full_name} code={row.employee_code} photo={row.photo} />
      ),
    },
    {
      key: 'department_name',
      header: 'Department',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate">{row.department_name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.designation_title}</p>
        </div>
      ),
    },
    {
      key: 'email',
      header: 'Contact',
      className: 'hidden md:table-cell',
      headClassName: 'hidden md:table-cell',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate">{row.email}</p>
          <p className="truncate text-xs text-muted-foreground">{row.phone || '—'}</p>
        </div>
      ),
    },
    {
      key: 'date_joined',
      header: 'Joined',
      className: 'hidden lg:table-cell tabular-nums',
      headClassName: 'hidden lg:table-cell',
      cell: (row) => formatDate(row.date_joined),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusBadge kind="employee" value={row.status} />,
    },
    {
      key: 'is_enrolled',
      header: 'Face',
      cell: (row) =>
        row.is_enrolled ? (
          <Badge tone="success">Enrolled</Badge>
        ) : (
          <Badge tone="muted">Not enrolled</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      cell: (row) => (
        <div className="flex justify-end gap-1">
          {isHR && (
            <>
              <Button
                variant="ghost" size="icon"
                aria-label={`Enrol face for ${row.full_name}`}
                onClick={(e) => { e.stopPropagation(); setEnrolling(row) }}
              >
                <ScanFace />
              </Button>
              <Button
                variant="ghost" size="icon"
                aria-label={`Edit ${row.full_name}`}
                onClick={(e) => { e.stopPropagation(); setEditing(row); setFormOpen(true) }}
              >
                <Pencil />
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/employees/${row.id}`} onClick={(e) => e.stopPropagation()}>
              View
            </Link>
          </Button>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader title="Employees" description="Everyone on the payroll and their enrolment status.">
        {isHR && (
          <Button onClick={() => { setEditing(null); setFormOpen(true) }}>
            <Plus /> Add employee
          </Button>
        )}
      </PageHeader>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search name, code or email…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              />
            </div>

            <Select value={department} onValueChange={(v) => setParam('department', v)}>
              <SelectTrigger className="sm:w-44"><SelectValue placeholder="Department" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All departments</SelectItem>
                {(departments?.results ?? []).map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={status} onValueChange={(v) => setParam('status', v)}>
              <SelectTrigger className="sm:w-36"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {Object.entries(EMPLOYEE_STATUS).map(([value, { label }]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={enrolled} onValueChange={(v) => setParam('enrolled', v)}>
              <SelectTrigger className="sm:w-40"><SelectValue placeholder="Enrolment" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any enrolment</SelectItem>
                <SelectItem value="true">Face enrolled</SelectItem>
                <SelectItem value="false">Not enrolled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>

        <DataTable
          columns={columns}
          rows={rows}
          loading={isLoading}
          empty={{
            icon: Users,
            title: 'No employees found',
            description: debouncedSearch
              ? 'Try a different search or clear the filters.'
              : 'Add your first employee to get started.',
            action: isHR && !debouncedSearch
              ? <Button onClick={() => { setEditing(null); setFormOpen(true) }}><Plus /> Add employee</Button>
              : undefined,
          }}
        />

        <Pagination page={page} count={data?.count} onChange={setPage} />
      </Card>

      <EmployeeFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        employee={editing}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['employees'] })}
      />

      <EnrollFaceDialog
        employee={enrolling}
        open={Boolean(enrolling)}
        onOpenChange={(open) => !open && setEnrolling(null)}
        onEnrolled={() => {
          queryClient.invalidateQueries({ queryKey: ['employees'] })
          queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        }}
      />
    </>
  )
}
