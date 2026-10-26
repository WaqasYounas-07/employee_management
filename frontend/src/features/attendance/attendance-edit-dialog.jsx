import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
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
import { ATTENDANCE_STATUS } from '@/lib/constants'
import { formatDate } from '@/lib/format'

/** Converts an ISO timestamp to the value a datetime-local input expects. */
function toLocalInput(value) {
  if (!value) return ''
  const date = new Date(value)
  const pad = (n) => `${n}`.padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function AttendanceEditDialog({ record, open, onOpenChange, onSaved }) {
  const [form, setForm] = useState({ check_in: '', check_out: '', status: 'present', note: '' })
  const [error, setError] = useState('')

  useEffect(() => {
    if (!record) return
    setError('')
    setForm({
      check_in: toLocalInput(record.check_in),
      check_out: toLocalInput(record.check_out),
      status: record.status,
      note: record.note ?? '',
    })
  }, [record])

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        status: form.status,
        note: form.note,
        // An empty input clears the timestamp rather than sending "".
        check_in: form.check_in ? new Date(form.check_in).toISOString() : null,
        check_out: form.check_out ? new Date(form.check_out).toISOString() : null,
      }
      return (await api.patch(`/attendance/${record.id}/`, payload)).data
    },
    onSuccess: () => {
      toast.success('Attendance corrected.')
      onSaved?.()
      onOpenChange(false)
    },
    onError: (err) => {
      setError(errorMessage(err, 'Could not save the correction.'))
      toast.error(errorMessage(err, 'Could not save the correction.'))
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct attendance</DialogTitle>
          <DialogDescription>
            {record?.employee_name} · {formatDate(record?.date)}. Hours, lateness
            and overtime are recalculated from these times.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => { e.preventDefault(); mutation.mutate() }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="check-in">Check in</Label>
              <Input
                id="check-in" type="datetime-local" value={form.check_in}
                onChange={(e) => setForm((f) => ({ ...f, check_in: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="check-out">Check out</Label>
              <Input
                id="check-out" type="datetime-local" value={form.check_out}
                onChange={(e) => setForm((f) => ({ ...f, check_out: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select
              value={form.status}
              onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(ATTENDANCE_STATUS).map(([value, { label }]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">Reason for the correction</Label>
            <Textarea
              id="note" rows={2} value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="Camera missed the entry; confirmed with the manager."
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
            <Button type="submit" loading={mutation.isPending}>Save correction</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
