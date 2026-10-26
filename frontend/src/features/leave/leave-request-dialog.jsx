import { useEffect, useState } from 'react'
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/features/auth/auth-context'
import { toISODate } from '@/lib/format'

export function LeaveRequestDialog({ open, onOpenChange, onSaved }) {
  const { isStaff, user } = useAuth()
  const [form, setForm] = useState({
    employee: '', leave_type: '', start_date: toISODate(), end_date: toISODate(), reason: '',
  })
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setForm({
      employee: isStaff ? '' : String(user?.employee?.id ?? ''),
      leave_type: '',
      start_date: toISODate(),
      end_date: toISODate(),
      reason: '',
    })
  }, [open, isStaff, user])

  const { data: leaveTypes } = useQuery({
    queryKey: ['leave-types'],
    queryFn: async () => (await api.get('/leave-types/', { params: { page_size: 100 } })).data,
    enabled: open,
  })

  const { data: employees } = useQuery({
    queryKey: ['employees', 'picker'],
    queryFn: async () => (await api.get('/employees/', { params: { page_size: 200 } })).data,
    enabled: open && isStaff,
  })

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        leave_type: Number(form.leave_type),
        start_date: form.start_date,
        end_date: form.end_date,
        reason: form.reason,
      }
      // Employees may only file for themselves; the backend enforces it too.
      if (isStaff && form.employee) payload.employee = Number(form.employee)
      else if (user?.employee?.id) payload.employee = user.employee.id
      return (await api.post('/leave-requests/', payload)).data
    },
    onSuccess: () => {
      toast.success('Leave request submitted.')
      onSaved?.()
      onOpenChange(false)
    },
    onError: (err) => {
      setError(errorMessage(err, 'Could not submit the request.'))
      toast.error(errorMessage(err, 'Could not submit the request.'))
    },
  })

  const noEmployeeRecord = !isStaff && !user?.employee?.id

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request leave</DialogTitle>
          <DialogDescription>
            Approved leave is recorded as attendance, so those days are never marked absent.
          </DialogDescription>
        </DialogHeader>

        {noEmployeeRecord ? (
          <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
            Your account is not linked to an employee record, so leave cannot be
            requested. Ask HR to link it.
          </p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); mutation.mutate() }}
          >
            {isStaff && (
              <div className="space-y-1.5">
                <Label>Employee <span className="text-destructive">*</span></Label>
                <Select
                  value={form.employee}
                  onValueChange={(v) => setForm((f) => ({ ...f, employee: v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {(employees?.results ?? []).map((e) => (
                      <SelectItem key={e.id} value={String(e.id)}>
                        {e.full_name} ({e.employee_code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Leave type <span className="text-destructive">*</span></Label>
              <Select
                value={form.leave_type}
                onValueChange={(v) => setForm((f) => ({ ...f, leave_type: v }))}
              >
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {(leaveTypes?.results ?? []).map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}{t.annual_quota ? ` · ${t.annual_quota} days/year` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="start">From <span className="text-destructive">*</span></Label>
                <Input
                  id="start" type="date" required value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end">To <span className="text-destructive">*</span></Label>
                <Input
                  id="end" type="date" required value={form.end_date}
                  min={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason</Label>
              <Textarea
                id="reason" rows={3} value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </div>

            {error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit" loading={mutation.isPending}
                disabled={!form.leave_type || (isStaff && !form.employee)}
              >
                Submit request
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
