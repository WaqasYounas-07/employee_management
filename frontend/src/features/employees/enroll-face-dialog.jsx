import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Camera as CameraIcon, CheckCircle2, Info, RefreshCw, Trash2, Upload,
} from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { formatDate } from '@/lib/format'

/**
 * Enrols a face from the webcam or a file.
 *
 * The backend accepts several templates per employee and recommends it:
 * different angles and lighting raise the match rate at the door. So this
 * dialog stays open after a successful enrolment and invites another shot.
 */
export function EnrollFaceDialog({ employee, open, onOpenChange, onEnrolled }) {
  const queryClient = useQueryClient()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const fileRef = useRef(null)

  const [tab, setTab] = useState('camera')
  const [preview, setPreview] = useState(null)   // { blob, url }
  const [cameraError, setCameraError] = useState('')
  const [cameraReady, setCameraReady] = useState(false)

  const { data: templates, refetch: refetchTemplates } = useQuery({
    queryKey: ['face-templates', employee?.id],
    queryFn: async () =>
      (await api.get(`/employees/${employee.id}/face-templates/`)).data,
    enabled: Boolean(open && employee?.id),
  })

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraReady(false)
  }, [])

  const startCamera = useCallback(async () => {
    setCameraError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraReady(true)
    } catch (error) {
      // A denied permission or a machine with no webcam: upload still works.
      setCameraError(
        error?.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow it in your browser, or upload a photo instead.'
          : 'No camera is available. Upload a photo instead.',
      )
      setCameraReady(false)
    }
  }, [])

  useEffect(() => {
    if (open && tab === 'camera' && !preview) startCamera()
    else stopCamera()
    return stopCamera
  }, [open, tab, preview, startCamera, stopCamera])

  // Revoke the object URL when the preview changes or the dialog closes.
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url) }, [preview])

  useEffect(() => {
    if (!open) {
      setPreview(null)
      setTab('camera')
      setCameraError('')
    }
  }, [open])

  const capture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (blob) setPreview({ blob, url: URL.createObjectURL(blob) })
      },
      'image/jpeg',
      0.92,
    )
  }

  const onFile = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setPreview({ blob: file, url: URL.createObjectURL(file) })
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const body = new FormData()
      body.append('image', preview.blob, 'face.jpg')
      return (await api.post(`/employees/${employee.id}/enroll-face/`, body)).data
    },
    onSuccess: (data) => {
      toast.success(
        `Face enrolled. ${data.total_templates} template${data.total_templates === 1 ? '' : 's'} on file.`,
      )
      setPreview(null)
      refetchTemplates()
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      onEnrolled?.()
    },
    // The backend explains exactly what is wrong (no face, too small, already
    // enrolled to somebody else) — surface that rather than a generic error.
    onError: (error) => toast.error(errorMessage(error, 'Could not enrol this face.')),
  })

  const deleteTemplate = useMutation({
    mutationFn: async (id) => api.delete(`/face-templates/${id}/`),
    onSuccess: () => {
      toast.success('Template removed.')
      refetchTemplates()
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      onEnrolled?.()
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not remove the template.')),
  })

  const active = (templates ?? []).filter((t) => t.is_active)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Enrol face — {employee?.full_name}</DialogTitle>
          <DialogDescription>
            Capture the face that the door cameras will recognise.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2.5 rounded-md bg-info/10 p-3 text-xs text-info">
          <Info className="mt-px h-4 w-4 shrink-0" />
          <p>
            Add several shots from different angles and lighting — the match
            rate at the door depends on it. Face the camera straight on, fill
            the frame, and make sure only one person is visible.
          </p>
        </div>

        {preview ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-border bg-muted">
              <img src={preview.url} alt="Captured face" className="max-h-80 w-full object-contain" />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline" className="flex-1"
                onClick={() => setPreview(null)}
                disabled={mutation.isPending}
              >
                <RefreshCw /> Retake
              </Button>
              <Button
                className="flex-1"
                onClick={() => mutation.mutate()}
                loading={mutation.isPending}
              >
                <CheckCircle2 /> Enrol this face
              </Button>
            </div>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="camera"><CameraIcon /> Use camera</TabsTrigger>
              <TabsTrigger value="upload"><Upload /> Upload photo</TabsTrigger>
            </TabsList>

            <TabsContent value="camera" className="space-y-3">
              <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-muted">
                <video
                  ref={videoRef}
                  playsInline muted
                  className="h-full w-full object-cover"
                />
                {/* A framing guide so the face fills enough of the shot to
                    pass the backend's quality check. */}
                {cameraReady && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="h-[78%] aspect-[3/4] rounded-full border-2 border-dashed border-primary/70" />
                  </div>
                )}
                {cameraError && (
                  <div className="absolute inset-0 flex items-center justify-center p-6">
                    <p className="text-center text-sm text-muted-foreground">{cameraError}</p>
                  </div>
                )}
              </div>
              <Button className="w-full" onClick={capture} disabled={!cameraReady}>
                <CameraIcon /> Capture
              </Button>
            </TabsContent>

            <TabsContent value="upload">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-10 transition-colors hover:border-primary hover:bg-accent/40"
              >
                <Upload className="h-7 w-7 text-muted-foreground" />
                <span className="text-sm font-medium">Choose a photo</span>
                <span className="text-xs text-muted-foreground">JPG or PNG, one face only</span>
              </button>
              <input
                ref={fileRef} type="file" accept="image/*"
                className="hidden" onChange={onFile}
              />
            </TabsContent>
          </Tabs>
        )}

        {active.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Enrolled templates</p>
                <Badge tone="success">{active.length} active</Badge>
              </div>
              <ul className="max-h-40 space-y-1.5 overflow-y-auto">
                {active.map((template) => (
                  <li
                    key={template.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-3">
                      {template.source_image && (
                        <img
                          src={template.source_image} alt=""
                          className="h-9 w-9 rounded object-cover"
                        />
                      )}
                      <div>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(template.created_at)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Quality {(template.quality_score * 100).toFixed(0)}%
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost" size="icon"
                      aria-label="Remove template"
                      onClick={() => deleteTemplate.mutate(template.id)}
                      disabled={deleteTemplate.isPending}
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
