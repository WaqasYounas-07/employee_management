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
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { CAMERA_DIRECTION } from '@/lib/constants'

const BLANK = {
  name: '', location: '', stream_url: '',
  direction: 'both', min_confidence: 0.6, is_active: true,
}

export function CameraFormDialog({ open, onOpenChange, camera, onSaved }) {
  const editing = Boolean(camera)
  const [form, setForm] = useState(BLANK)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (!open) return
    setErrors({})
    setForm(camera ? { ...BLANK, ...camera } : BLANK)
  }, [open, camera])

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = { ...form, min_confidence: Number(form.min_confidence) }
      if (editing) return (await api.patch(`/cameras/${camera.id}/`, payload)).data
      return (await api.post('/cameras/', payload)).data
    },
    onSuccess: () => {
      toast.success(editing ? 'Camera updated.' : 'Camera added.')
      onSaved?.()
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
      toast.error(errorMessage(error, 'Could not save the camera.'))
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit camera' : 'Add camera'}</DialogTitle>
          <DialogDescription>
            A camera gets its own device key, which it uses to post frames.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => { e.preventDefault(); mutation.mutate() }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="name">Name <span className="text-destructive">*</span></Label>
            <Input
              id="name" value={form.name} required
              placeholder="Main Gate"
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              aria-invalid={Boolean(errors.name)}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="location">Location <span className="text-destructive">*</span></Label>
            <Input
              id="location" value={form.location} required
              placeholder="Entrance, ground floor"
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              aria-invalid={Boolean(errors.location)}
            />
            {errors.location && <p className="text-xs text-destructive">{errors.location}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="stream">Stream URL</Label>
            <Input
              id="stream" value={form.stream_url}
              placeholder="rtsp://192.168.1.50:554/stream"
              onChange={(e) => setForm((f) => ({ ...f, stream_url: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Optional. Where the edge worker reads frames from.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Direction</Label>
            <Select
              value={form.direction}
              onValueChange={(v) => setForm((f) => ({ ...f, direction: v }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(CAMERA_DIRECTION).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              An entry-only camera can never check somebody out.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confidence">
              Minimum confidence — {(form.min_confidence * 100).toFixed(0)}%
            </Label>
            <input
              id="confidence" type="range" min="0.3" max="0.95" step="0.05"
              value={form.min_confidence}
              onChange={(e) => setForm((f) => ({ ...f, min_confidence: e.target.value }))}
              className="w-full accent-[hsl(var(--primary))]"
            />
            <p className="text-xs text-muted-foreground">
              Matches below this are logged but do not mark attendance. Raise it
              in a busy doorway, lower it if people are being missed.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="active">Enabled</Label>
              <p className="text-xs text-muted-foreground">
                A disabled camera is rejected at the ingest endpoint.
              </p>
            </div>
            <Switch
              id="active" checked={form.is_active}
              onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {editing ? 'Save changes' : 'Add camera'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
