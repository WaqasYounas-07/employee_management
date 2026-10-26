import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ScanSearch } from 'lucide-react'
import { api } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import { DataTable } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/status-badge'
import { EmployeeCell } from '@/components/shared/employee-cell'
import { Pagination } from '@/components/shared/pagination'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { RECOGNITION_DECISION } from '@/lib/constants'
import { formatDateTime, toISODate } from '@/lib/format'

const ALL = '__all__'

/**
 * The raw audit log. Every frame a camera posts lands here, matched or not,
 * which is what makes a missed recognition at the gate diagnosable.
 */
export function RecognitionEventsPage() {
  const [date, setDate] = useState(toISODate())
  const [decision, setDecision] = useState(ALL)
  const [camera, setCamera] = useState(ALL)
  const [page, setPage] = useState(1)

  const { data: cameras } = useQuery({
    queryKey: ['cameras'],
    queryFn: async () => (await api.get('/cameras/', { params: { page_size: 100 } })).data,
  })

  const params = {
    page,
    date: date || undefined,
    decision: decision === ALL ? undefined : decision,
    camera: camera === ALL ? undefined : camera,
  }

  const { data, isLoading } = useQuery({
    queryKey: ['recognition-events', params],
    queryFn: async () => (await api.get('/recognition-events/', { params })).data,
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  })

  const columns = [
    {
      key: 'captured_at', header: 'Time',
      cell: (r) => formatDateTime(r.captured_at), className: 'tabular-nums whitespace-nowrap',
    },
    { key: 'camera_name', header: 'Camera' },
    {
      key: 'employee', header: 'Employee',
      cell: (r) =>
        r.employee_name
          ? <EmployeeCell name={r.employee_name} code={r.employee_code} size="sm" />
          : <span className="text-muted-foreground">Unknown</span>,
    },
    {
      key: 'decision', header: 'Decision',
      cell: (r) => <StatusBadge kind="recognition" value={r.decision} />,
    },
    {
      key: 'confidence', header: 'Confidence', className: 'tabular-nums',
      cell: (r) => (r.confidence ? `${(r.confidence * 100).toFixed(0)}%` : '—'),
    },
    {
      key: 'message', header: 'Detail',
      className: 'hidden lg:table-cell max-w-xs truncate text-muted-foreground',
      headClassName: 'hidden lg:table-cell',
    },
  ]

  return (
    <>
      <PageHeader
        title="Recognition log"
        description="Every frame the cameras submitted — including the ones that matched nobody."
      />

      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date" type="date" className="sm:w-40" value={date}
                onChange={(e) => { setDate(e.target.value); setPage(1) }}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Decision</Label>
              <Select value={decision} onValueChange={(v) => { setDecision(v); setPage(1) }}>
                <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All decisions</SelectItem>
                  {Object.entries(RECOGNITION_DECISION).map(([value, { label }]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Camera</Label>
              <Select value={camera} onValueChange={(v) => { setCamera(v); setPage(1) }}>
                <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All cameras</SelectItem>
                  {(cameras?.results ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>

        <DataTable
          columns={columns}
          rows={data?.results ?? []}
          loading={isLoading}
          empty={{
            icon: ScanSearch,
            title: 'No events for these filters',
            description: 'Events appear as soon as a camera posts a frame.',
          }}
        />

        <Pagination page={page} count={data?.count} onChange={setPage} />
      </Card>
    </>
  )
}
