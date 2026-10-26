import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Building2, Clock, Plus, CalendarDays, Palmtree } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import { DataTable } from '@/components/shared/data-table'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { formatDate } from '@/lib/format'

/** A small create dialog shared by every settings tab. */
function CreateDialog({ open, onOpenChange, title, fields, endpoint, queryKey, initial }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState({})

  const mutation = useMutation({
    mutationFn: async () => (await api.post(endpoint, form)).data,
    onSuccess: () => {
      toast.success(`${title} created.`)
      queryClient.invalidateQueries({ queryKey })
      setForm(initial)
      setErrors({})
      onOpenChange(false)
    },
    onError: (error) => {
      const data = error?.response?.data
      if (data && typeof data === 'object') {
        setErrors(
          Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)]),
          ),
        )
      }
      toast.error(errorMessage(error, `Could not create the ${title.toLowerCase()}.`))
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!next) { setForm(initial); setErrors({}) } onOpenChange(next) }}
    >
      <DialogContent>
        <DialogHeader><DialogTitle>New {title.toLowerCase()}</DialogTitle></DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => { e.preventDefault(); mutation.mutate() }}
        >
          {fields.map((field) => (
            <div key={field.name} className="space-y-1.5">
              <Label htmlFor={field.name}>
                {field.label}
                {field.required && <span className="ml-0.5 text-destructive">*</span>}
              </Label>
              {field.type === 'select' ? (
                <Select
                  value={String(form[field.name] ?? '')}
                  onValueChange={(v) => setForm((f) => ({ ...f, [field.name]: v }))}
                >
                  <SelectTrigger><SelectValue placeholder={field.placeholder} /></SelectTrigger>
                  <SelectContent>
                    {field.options?.map((o) => (
                      <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={field.name}
                  type={field.type ?? 'text'}
                  value={form[field.name] ?? ''}
                  placeholder={field.placeholder}
                  required={field.required}
                  step={field.step}
                  onChange={(e) => setForm((f) => ({ ...f, [field.name]: e.target.value }))}
                  aria-invalid={Boolean(errors[field.name])}
                />
              )}
              {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
              {errors[field.name] && (
                <p className="text-xs text-destructive">{errors[field.name]}</p>
              )}
            </div>
          ))}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SettingsSection({ title, description, icon, columns, endpoint, queryKey, fields, initial }) {
  const [open, setOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => (await api.get(endpoint, { params: { page_size: 100 } })).data,
  })

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus /> Add</Button>
      </CardContent>

      <DataTable
        columns={columns}
        rows={data?.results ?? []}
        loading={isLoading}
        empty={{ icon, title: `No ${title.toLowerCase()} yet` }}
      />

      <CreateDialog
        open={open} onOpenChange={setOpen}
        title={title.replace(/s$/, '')}
        fields={fields} endpoint={endpoint}
        queryKey={queryKey} initial={initial}
      />
    </Card>
  )
}

const TABS = ['departments', 'designations', 'shifts', 'leave-types', 'holidays']

export function SettingsPage() {
  /* The tab lives in the URL so the sidebar can link straight to one and the
     page is shareable. */
  const [params, setParams] = useSearchParams()
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : TABS[0]

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => (await api.get('/departments/', { params: { page_size: 100 } })).data,
  })

  return (
    <>
      <PageHeader
        title="Settings"
        description="Organisation structure, shifts and the holiday calendar."
      />

      <Tabs
        value={tab}
        onValueChange={(next) => setParams({ tab: next }, { replace: true })}
      >
        <TabsList className="flex-wrap">
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="designations">Designations</TabsTrigger>
          <TabsTrigger value="shifts">Shifts</TabsTrigger>
          <TabsTrigger value="leave-types">Leave types</TabsTrigger>
          <TabsTrigger value="holidays">Holidays</TabsTrigger>
        </TabsList>

        <TabsContent value="departments">
          <SettingsSection
            title="Departments"
            description="Groups employees for reporting and the dashboard breakdown."
            icon={Building2}
            endpoint="/departments/" queryKey={['departments']}
            columns={[
              { key: 'name', header: 'Name' },
              { key: 'code', header: 'Code' },
              {
                key: 'employee_count', header: 'Employees',
                cell: (r) => <Badge tone="muted">{r.employee_count ?? 0}</Badge>,
              },
            ]}
            initial={{ name: '', code: '', description: '' }}
            fields={[
              { name: 'name', label: 'Name', required: true, placeholder: 'Engineering' },
              { name: 'code', label: 'Code', required: true, placeholder: 'ENG' },
              { name: 'description', label: 'Description' },
            ]}
          />
        </TabsContent>

        <TabsContent value="designations">
          <SettingsSection
            title="Designations"
            description="Job titles. Each belongs to one department."
            icon={Building2}
            endpoint="/designations/" queryKey={['designations']}
            columns={[
              { key: 'title', header: 'Title' },
              { key: 'department_name', header: 'Department' },
            ]}
            initial={{ title: '', department: '' }}
            fields={[
              { name: 'title', label: 'Title', required: true, placeholder: 'Software Engineer' },
              {
                name: 'department', label: 'Department', type: 'select', required: true,
                placeholder: 'Select department',
                options: (departments?.results ?? []).map((d) => ({ value: d.id, label: d.name })),
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="shifts">
          <SettingsSection
            title="Shifts"
            description="Working hours. These decide what counts as late, a half day, or overtime."
            icon={Clock}
            endpoint="/shifts/" queryKey={['shifts']}
            columns={[
              { key: 'name', header: 'Name' },
              {
                key: 'hours', header: 'Hours', className: 'tabular-nums',
                cell: (r) => `${r.start_time?.slice(0, 5)} – ${r.end_time?.slice(0, 5)}`,
              },
              { key: 'grace_minutes', header: 'Grace', cell: (r) => `${r.grace_minutes} min`, className: 'tabular-nums' },
              { key: 'full_day_hours', header: 'Full day', cell: (r) => `${r.full_day_hours}h`, className: 'tabular-nums' },
              {
                key: 'is_overnight', header: '',
                cell: (r) => (r.is_overnight ? <Badge tone="info">Overnight</Badge> : null),
              },
            ]}
            initial={{
              name: '', start_time: '09:00', end_time: '18:00',
              grace_minutes: '15', half_day_hours: '4', full_day_hours: '8',
            }}
            fields={[
              { name: 'name', label: 'Name', required: true, placeholder: 'General' },
              { name: 'start_time', label: 'Start time', type: 'time', required: true },
              { name: 'end_time', label: 'End time', type: 'time', required: true },
              {
                name: 'grace_minutes', label: 'Grace period (minutes)', type: 'number',
                hint: 'Arrivals within this window are still on time.',
              },
              {
                name: 'half_day_hours', label: 'Half day below (hours)', type: 'number', step: '0.5',
                hint: 'Must be less than the full day hours.',
              },
              { name: 'full_day_hours', label: 'Full day (hours)', type: 'number', step: '0.5' },
            ]}
          />
        </TabsContent>

        <TabsContent value="leave-types">
          <SettingsSection
            title="Leave types"
            description="The categories employees can request time off under."
            icon={Palmtree}
            endpoint="/leave-types/" queryKey={['leave-types']}
            columns={[
              { key: 'name', header: 'Name' },
              { key: 'annual_quota', header: 'Annual quota', cell: (r) => `${r.annual_quota} days`, className: 'tabular-nums' },
              {
                key: 'is_paid', header: 'Paid',
                cell: (r) => (r.is_paid ? <Badge tone="success">Paid</Badge> : <Badge tone="muted">Unpaid</Badge>),
              },
            ]}
            initial={{ name: '', annual_quota: '0', is_paid: true }}
            fields={[
              { name: 'name', label: 'Name', required: true, placeholder: 'Annual Leave' },
              { name: 'annual_quota', label: 'Annual quota (days)', type: 'number' },
            ]}
          />
        </TabsContent>

        <TabsContent value="holidays">
          <SettingsSection
            title="Holidays"
            description="On these dates the end-of-day sweep records a holiday instead of absence."
            icon={CalendarDays}
            endpoint="/holidays/" queryKey={['holidays']}
            columns={[
              { key: 'date', header: 'Date', cell: (r) => formatDate(r.date), className: 'tabular-nums' },
              { key: 'name', header: 'Name' },
              {
                key: 'is_optional', header: '',
                cell: (r) => (r.is_optional ? <Badge tone="muted">Optional</Badge> : null),
              },
            ]}
            initial={{ name: '', date: '' }}
            fields={[
              { name: 'name', label: 'Name', required: true, placeholder: 'Independence Day' },
              { name: 'date', label: 'Date', type: 'date', required: true },
            ]}
          />
        </TabsContent>
      </Tabs>
    </>
  )
}
