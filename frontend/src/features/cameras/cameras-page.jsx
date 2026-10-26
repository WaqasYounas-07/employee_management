import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Camera, Copy, KeyRound, Plus, RefreshCw, Pencil, Wifi, WifiOff,
} from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { CAMERA_DIRECTION } from '@/lib/constants'
import { timeAgo } from '@/lib/format'
import { CameraFormDialog } from './camera-form-dialog'

export function CamerasPage() {
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [keyFor, setKeyFor] = useState(null)      // camera whose key is shown
  const [revealed, setRevealed] = useState('')
  const [rotating, setRotating] = useState(null)

  const { data, isLoading } = useQuery({
    queryKey: ['cameras'],
    queryFn: async () => (await api.get('/cameras/', { params: { page_size: 100 } })).data,
    refetchInterval: 60_000,
  })

  const revealKey = useMutation({
    mutationFn: async (camera) => (await api.get(`/cameras/${camera.id}/key/`)).data,
    onSuccess: (data, camera) => {
      setRevealed(data.api_key)
      setKeyFor(camera)
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not read the key.')),
  })

  const rotateKey = useMutation({
    mutationFn: async (camera) => (await api.post(`/cameras/${camera.id}/rotate-key/`)).data,
    onSuccess: (data) => {
      setRevealed(data.api_key)
      setRotating(null)
      toast.success('Key rotated. Update the camera with the new key.')
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not rotate the key.')),
  })

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied to clipboard.')
    } catch {
      toast.error('Could not copy. Select the key and copy it manually.')
    }
  }

  const cameras = data?.results ?? []

  return (
    <>
      <PageHeader
        title="Cameras"
        description="Door cameras that recognise employees and mark attendance."
      >
        <Button onClick={() => { setEditing(null); setFormOpen(true) }}>
          <Plus /> Add camera
        </Button>
      </PageHeader>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44 w-full" />)}
        </div>
      ) : cameras.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cameras.map((camera) => (
            <Card key={camera.id}>
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Camera className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{camera.name}</p>
                      <p className="truncate text-sm text-muted-foreground">{camera.location}</p>
                    </div>
                  </div>
                  {camera.is_online ? (
                    <Badge tone="success"><Wifi className="mr-1 h-3 w-3" /> Online</Badge>
                  ) : (
                    <Badge tone="muted"><WifiOff className="mr-1 h-3 w-3" /> Offline</Badge>
                  )}
                </div>

                <Separator />

                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Direction</dt>
                    <dd className="font-medium">{CAMERA_DIRECTION[camera.direction]}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Min confidence</dt>
                    <dd className="font-medium tabular-nums">
                      {(camera.min_confidence * 100).toFixed(0)}%
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Last seen</dt>
                    <dd className="font-medium">{timeAgo(camera.last_seen_at)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Enabled</dt>
                    <dd className="font-medium">{camera.is_active ? 'Yes' : 'No'}</dd>
                  </div>
                </dl>

                <div className="flex gap-2">
                  <Button
                    variant="outline" size="sm" className="flex-1"
                    onClick={() => revealKey.mutate(camera)}
                  >
                    <KeyRound /> Device key
                  </Button>
                  <Button
                    variant="ghost" size="icon"
                    aria-label={`Edit ${camera.name}`}
                    onClick={() => { setEditing(camera); setFormOpen(true) }}
                  >
                    <Pencil />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={Camera}
            title="No cameras yet"
            description="Add a camera at your entrance, then point it at the ingest endpoint using its device key."
            action={
              <Button onClick={() => { setEditing(null); setFormOpen(true) }}>
                <Plus /> Add camera
              </Button>
            }
          />
        </Card>
      )}

      {/* Device key panel. The key authenticates the camera itself, so it is
          shown on request rather than listed with every camera. */}
      {keyFor && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">Device key — {keyFor.name}</p>
                <p className="text-sm text-muted-foreground">
                  Configure this on the camera or edge worker. Treat it like a password.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => copy(revealed)}>
                  <Copy /> Copy
                </Button>
                <Button variant="outline" size="sm" onClick={() => setRotating(keyFor)}>
                  <RefreshCw /> Rotate
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setKeyFor(null); setRevealed('') }}>
                  Hide
                </Button>
              </div>
            </div>

            <code className="block break-all rounded-md bg-muted px-3 py-2 font-mono text-sm">
              {revealed}
            </code>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                Post a frame from the camera:
              </p>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
{`curl -X POST ${import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api'}/cameras/ingest/ \\
  -H "X-Camera-Key: ${revealed}" \\
  -F "image=@frame.jpg"`}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}

      <CameraFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        camera={editing}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['cameras'] })}
      />

      <ConfirmDialog
        open={Boolean(rotating)}
        onOpenChange={(open) => !open && setRotating(null)}
        title="Rotate the device key?"
        description="The current key stops working immediately. The camera will not be able to post frames until you configure it with the new key."
        confirmLabel="Rotate key"
        destructive
        loading={rotateKey.isPending}
        onConfirm={() => rotateKey.mutate(rotating)}
      />
    </>
  )
}
