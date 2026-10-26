import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { EMPLOYEE_STATUS, EMPLOYMENT_TYPE } from '@/lib/constants'
import { toISODate } from '@/lib/format'

const BLANK = {
  employee_code: '', first_name: '', last_name: '', email: '', phone: '',
  cnic: '', date_of_birth: '', address: '', department: '', designation: '',
  shift: '', employment_type: 'full_time', status: 'active',
  date_joined: toISODate(), salary: '0',
}

function Field({ label, error, children, required }) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

export function EmployeeFormDialog({ open, onOpenChange, employee, onSaved }) {
  const editing = Boolean(employee)
  const [form, setForm] = useState(BLANK)
  const [createLogin, setCreateLogin] = useState(false)
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState({})

  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  useEffect(() => {
    if (!open) return
    setErrors({})
    setPassword('')
    setCreateLogin(false)
    if (employee) {
      setForm({
        ...BLANK,
        ...employee,
        department: String(employee.department ?? ''),
        designation: String(employee.designation ?? ''),
        shift: String(employee.shift ?? ''),
        date_of_birth: employee.date_of_birth ?? '',
        salary: String(employee.salary ?? '0'),
      })
    } else {
      setForm(BLANK)
    }
  }, [open, employee])

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => (await api.get('/departments/', { params: { page_size: 100 } })).data,
    enabled: open,
  })
  const { data: designations } = useQuery({
    queryKey: ['designations'],
    queryFn: async () => (await api.get('/designations/', { params: { page_size: 200 } })).data,
    enabled: open,
  })
  const { data: shifts } = useQuery({
    queryKey: ['shifts'],
    queryFn: async () => (await api.get('/shifts/', { params: { page_size: 100 } })).data,
    enabled: open,
  })

  /* The backend rejects a designation from another department, so only offer
     the ones that belong to the chosen department. */
  const availableDesignations = useMemo(() => {
    const all = designations?.results ?? []
    if (!form.department) return all
    return all.filter((d) => String(d.department) === String(form.department))
  }, [designations, form.department])

  const mutation = useMutation({
    mutationFn: async (payload) => {
      if (editing) return (await api.patch(`/employees/${employee.id}/`, payload)).data
      return (await api.post('/employees/', payload)).data
    },
    onSuccess: () => {
      toast.success(editing ? 'Employee updated.' : 'Employee added.')
      onSaved?.()
      onOpenChange(false)
    },
    onError: (error) => {
      const data = error?.response?.data
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        setErrors(
          Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)]),
          ),
        )
      }
      toast.error(errorMessage(error, 'Could not save the employee.'))
    },
  })

  const onSubmit = (event) => {
    event.preventDefault()
    const payload = {
      ...form,
      salary: form.salary === '' ? '0' : form.salary,
      date_of_birth: form.date_of_birth || null,
      department: Number(form.department),
      designation: Number(form.designation),
      shift: Number(form.shift),
    }
    // These only apply when creating; the backend ignores them on update.
    if (!editing) {
      payload.create_login = createLogin
      if (createLogin) payload.password = password
    }
    mutation.mutate(payload)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit employee' : 'Add employee'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update this employee’s details.'
              : 'Create an employee record. You can enrol their face afterwards.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Employee code" error={errors.employee_code} required>
              <Input
                value={form.employee_code}
                onChange={(e) => set('employee_code')(e.target.value)}
                placeholder="EMP001" required
                aria-invalid={Boolean(errors.employee_code)}
              />
            </Field>
            <Field label="Email" error={errors.email} required>
              <Input
                type="email" value={form.email}
                onChange={(e) => set('email')(e.target.value)}
                placeholder="name@company.com" required
                aria-invalid={Boolean(errors.email)}
              />
            </Field>
            <Field label="First name" error={errors.first_name} required>
              <Input
                value={form.first_name}
                onChange={(e) => set('first_name')(e.target.value)}
                required aria-invalid={Boolean(errors.first_name)}
              />
            </Field>
            <Field label="Last name" error={errors.last_name} required>
              <Input
                value={form.last_name}
                onChange={(e) => set('last_name')(e.target.value)}
                required aria-invalid={Boolean(errors.last_name)}
              />
            </Field>
            <Field label="Phone" error={errors.phone}>
              <Input value={form.phone} onChange={(e) => set('phone')(e.target.value)} />
            </Field>
            <Field label="CNIC / National ID" error={errors.cnic}>
              <Input value={form.cnic} onChange={(e) => set('cnic')(e.target.value)} />
            </Field>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Department" error={errors.department} required>
              <Select
                value={form.department}
                onValueChange={(v) => {
                  set('department')(v)
                  // Clear a designation that no longer belongs to this department.
                  setForm((f) => ({ ...f, department: v, designation: '' }))
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {(departments?.results ?? []).map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Designation" error={errors.designation} required>
              <Select
                value={form.designation}
                onValueChange={set('designation')}
                disabled={!form.department}
              >
                <SelectTrigger>
                  <SelectValue placeholder={form.department ? 'Select designation' : 'Pick a department first'} />
                </SelectTrigger>
                <SelectContent>
                  {availableDesignations.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Shift" error={errors.shift} required>
              <Select value={form.shift} onValueChange={set('shift')}>
                <SelectTrigger><SelectValue placeholder="Select shift" /></SelectTrigger>
                <SelectContent>
                  {(shifts?.results ?? []).map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name} ({s.start_time?.slice(0, 5)}–{s.end_time?.slice(0, 5)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Employment type" error={errors.employment_type}>
              <Select value={form.employment_type} onValueChange={set('employment_type')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(EMPLOYMENT_TYPE).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Status" error={errors.status}>
              <Select value={form.status} onValueChange={set('status')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(EMPLOYEE_STATUS).map(([value, { label }]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Date joined" error={errors.date_joined}>
              <Input
                type="date" value={form.date_joined}
                onChange={(e) => set('date_joined')(e.target.value)}
              />
            </Field>

            <Field label="Date of birth" error={errors.date_of_birth}>
              <Input
                type="date" value={form.date_of_birth ?? ''}
                onChange={(e) => set('date_of_birth')(e.target.value)}
              />
            </Field>

            <Field label="Salary" error={errors.salary}>
              <Input
                type="number" min="0" step="0.01" value={form.salary}
                onChange={(e) => set('salary')(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Address" error={errors.address}>
            <Textarea
              value={form.address}
              onChange={(e) => set('address')(e.target.value)}
              rows={2}
            />
          </Field>

          {!editing && (
            <>
              <Separator />
              <div className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="create-login">Create a login account</Label>
                    <p className="text-xs text-muted-foreground">
                      Lets this employee sign in to see their own attendance and request leave.
                    </p>
                  </div>
                  <Switch
                    id="create-login"
                    checked={createLogin}
                    onCheckedChange={setCreateLogin}
                  />
                </div>
                {createLogin && (
                  <Field label="Password" error={errors.password} required>
                    <Input
                      type="password" value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      minLength={8} required
                      aria-invalid={Boolean(errors.password)}
                    />
                  </Field>
                )}
              </div>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {editing ? 'Save changes' : 'Add employee'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
