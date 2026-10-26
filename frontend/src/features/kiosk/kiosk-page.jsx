import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle, Camera as CameraIcon, CheckCircle2, Clock, Loader2,
  LogIn, LogOut, Pause, Play, UserX, Video,
} from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { formatTime, initials } from '@/lib/format'

/* How the ingest endpoint's decisions are presented at the door. */
const DECISION = {
  matched:        { label: 'Recognised',     tone: 'success',     icon: CheckCircle2 },
  duplicate:      { label: 'Already marked', tone: 'info',        icon: Clock },
  no_match:       { label: 'Not recognised', tone: 'destructive', icon: UserX },
  low_confidence: { label: 'Unclear match',  tone: 'warning',     icon: AlertTriangle },
  no_face:        { label: 'No face',        tone: 'muted',       icon: UserX },
  error:          { label: 'Error',          tone: 'destructive', icon: AlertTriangle },
}

const ACTION = {
  check_in:           { label: 'Checked in',         icon: LogIn,  tone: 'success' },
  check_out:          { label: 'Checked out',        icon: LogOut, tone: 'info' },
  updated_check_out:  { label: 'Check-out updated',  icon: LogOut, tone: 'info' },
  duplicate:          { label: 'Already marked',     icon: Clock,  tone: 'muted' },
}

const INTERVALS = [
  { value: '2000', label: 'Every 2 seconds' },
  { value: '4000', label: 'Every 4 seconds' },
  { value: '8000', label: 'Every 8 seconds' },
]

/**
 * Turns this laptop's webcam into a door camera.
 *
 * The browser grabs a frame on a timer and posts it to the same
 * `/cameras/ingest/` endpoint a real camera uses, authenticated with that
 * camera's device key. Nothing about the backend changes -- this is just
 * another client of the door.
 */
/* Tone per decision, shared by the box and its name tag. */
const BOX_TONE = {
  matched:        { ring: 'border-emerald-400', tag: 'bg-emerald-500', glow: 'shadow-[0_0_0_3px_rgba(52,211,153,0.25)]' },
  duplicate:      { ring: 'border-sky-400',     tag: 'bg-sky-500',     glow: 'shadow-[0_0_0_3px_rgba(56,189,248,0.25)]' },
  low_confidence: { ring: 'border-amber-400',   tag: 'bg-amber-500',   glow: 'shadow-[0_0_0_3px_rgba(251,191,36,0.25)]' },
  no_match:       { ring: 'border-rose-400',    tag: 'bg-rose-500',    glow: 'shadow-[0_0_0_3px_rgba(251,113,133,0.25)]' },
}

/**
 * One face box, positioned by fractions of the frame so it lines up with the
 * video at any size. The video is mirrored for a natural selfie view, so the
 * box is mirrored to match.
 */
function FaceBox({ face }) {
  const tone = BOX_TONE[face.decision] ?? BOX_TONE.no_match
  const { x, y, w, h } = face.box
  const name = face.employee?.name ?? 'Unknown'
  const action = ACTION[face.attendance_action]

  return (
    <div
      className="pointer-events-none absolute transition-all duration-300 ease-out"
      style={{
        left: `${(1 - x - w) * 100}%`,   // mirrored to match the video
        top: `${y * 100}%`,
        width: `${w * 100}%`,
        height: `${h * 100}%`,
      }}
    >
      <div className={cn('h-full w-full rounded-lg border-[3px]', tone.ring, tone.glow)} />

      {/* Name tag, pinned under the box. */}
      <div className="absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap">
        <div className={cn(
          'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold text-white shadow-lg ring-1 ring-black/10',
          tone.tag,
        )}>
          {name}
          {face.employee?.code && (
            <span className="font-normal opacity-80">{face.employee.code}</span>
          )}
          {face.confidence > 0 && (
            <span className="font-normal opacity-80 tabular-nums">
              {(face.confidence * 100).toFixed(0)}%
            </span>
          )}
        </div>
        {action && (
          <p className="mx-auto mt-1 w-fit rounded bg-black/70 px-1.5 py-0.5 text-center text-[11px] font-medium text-white">
            {action.label}
          </p>
        )}
      </div>
    </div>
  )
}

/** Wall clock, so the kiosk screen shows the time attendance is being taken. */
function LiveClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="rounded-lg bg-black/70 px-3 py-1.5 text-right backdrop-blur">
      <p className="text-xl font-semibold tabular-nums leading-none text-white">
        {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </p>
      <p className="mt-0.5 text-[11px] text-white/80">
        {now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
      </p>
    </div>
  )
}

export function KioskPage() {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const canvasRef = useRef(null)
  // Held in a ref so the capture loop never posts two frames at once.
  const busyRef = useRef(false)

  const [cameraId, setCameraId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [interval, setIntervalMs] = useState('4000')
  const [running, setRunning] = useState(false)
  const [videoError, setVideoError] = useState('')
  const [cameraReady, setCameraReady] = useState(false)
  const [last, setLast] = useState(null)
  /* Boxes from the latest frame. They are a moment behind the live video --
     the round trip takes a beat -- so they fade out rather than snapping
     away, which reads as tracking instead of flicker. */
  const [faces, setFaces] = useState([])
  const [log, setLog] = useState([])
  const [posting, setPosting] = useState(false)

  const { data: cameras, isLoading } = useQuery({
    queryKey: ['cameras'],
    queryFn: async () => (await api.get('/cameras/', { params: { page_size: 100 } })).data,
  })

  const selected = (cameras?.results ?? []).find((c) => String(c.id) === cameraId)

  // Fetch the device key whenever the chosen camera changes.
  useEffect(() => {
    if (!cameraId) { setApiKey(''); return }
    let cancelled = false
    api.get(`/cameras/${cameraId}/key/`)
      .then(({ data }) => { if (!cancelled) setApiKey(data.api_key) })
      .catch(() => { if (!cancelled) setApiKey('') })
    return () => { cancelled = true }
  }, [cameraId])

  const stopVideo = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraReady(false)
  }, [])

  const startVideo = useCallback(async () => {
    setVideoError('')
    // Already streaming (a StrictMode double-mount, or a re-entry): leave it.
    if (streamRef.current?.getTracks().some((t) => t.readyState === 'live')) {
      setCameraReady(true)
      return
    }
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
      setVideoError('')
    } catch (error) {
      // A second attempt can fail because the first already holds the device.
      // Only report an error when nothing is actually streaming.
      if (streamRef.current?.getTracks().some((t) => t.readyState === 'live')) {
        setCameraReady(true)
        return
      }
      setCameraReady(false)
      setVideoError(
        error?.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow it in your browser and reload.'
          : 'No camera available on this device.',
      )
    }
  }, [])

  useEffect(() => {
    startVideo()
    // Deliberately not stopping on every re-run: only on unmount, so a
    // StrictMode remount does not fight itself for the device.
    return () => stopVideo()
  }, [startVideo, stopVideo])

  /** Grab the current frame and post it exactly as a door camera would. */
  const sendFrame = useCallback(async () => {
    const video = videoRef.current
    if (!video?.videoWidth || !apiKey || busyRef.current) return

    busyRef.current = true
    setPosting(true)
    try {
      const canvas = canvasRef.current ?? document.createElement('canvas')
      canvasRef.current = canvas
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d').drawImage(video, 0, 0)

      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.9),
      )
      if (!blob) return

      const body = new FormData()
      body.append('image', blob, 'frame.jpg')

      // The camera key, not the user's token -- this is the device speaking.
      const { data } = await api.post('/cameras/ingest/', body, {
        headers: { 'X-Camera-Key': apiKey },
        // Drop the JWT so the request authenticates as the camera only.
        transformRequest: [(d, headers) => { delete headers.Authorization; return d }],
      })

      const results = data.results ?? []
      const primary = results[0] ?? { decision: 'no_face', message: 'No face in frame.' }
      setLast({ ...primary, at: new Date().toISOString() })
      setFaces(results.filter((r) => r.box))

      // Only the meaningful outcomes are worth a line in the log.
      const worthLogging = results.filter((r) =>
        ['matched', 'low_confidence', 'no_match'].includes(r.decision),
      )
      if (worthLogging.length) {
        setLog((prev) => [
          ...worthLogging.map((r) => ({ ...r, at: new Date().toISOString(), id: r.event_id })),
          ...prev,
        ].slice(0, 25))
      }
    } catch (error) {
      setFaces([])
      setLast({
        decision: 'error',
        message: errorMessage(error, 'Could not reach the server.'),
        at: new Date().toISOString(),
      })
    } finally {
      busyRef.current = false
      setPosting(false)
    }
  }, [apiKey])

  // The capture loop.
  useEffect(() => {
    if (!running || !apiKey) {
      setFaces([])
      return
    }
    sendFrame()
    const timer = setInterval(sendFrame, Number(interval))
    return () => clearInterval(timer)
  }, [running, apiKey, interval, sendFrame])

  const decision = DECISION[last?.decision] ?? DECISION.no_face
  const DecisionIcon = decision.icon
  const action = ACTION[last?.attendance_action]

  return (
    <>
      <PageHeader
        title="Live camera"
        description="Use this device's camera as a door camera. Frames are posted to the same endpoint a real camera uses."
      >
        <Button
          onClick={() => setRunning((r) => !r)}
          disabled={!apiKey || !cameraReady}
          variant={running ? 'destructive' : 'default'}
        >
          {running ? <><Pause /> Stop</> : <><Play /> Start</>}
        </Button>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex-1 space-y-1.5">
                <Label>Act as camera</Label>
                <Select value={cameraId} onValueChange={setCameraId} disabled={running}>
                  <SelectTrigger>
                    <SelectValue placeholder={isLoading ? 'Loading…' : 'Choose a camera'} />
                  </SelectTrigger>
                  <SelectContent>
                    {(cameras?.results ?? []).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name} — {c.location}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:w-48">
                <Label>Capture rate</Label>
                <Select value={interval} onValueChange={setIntervalMs}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INTERVALS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-muted">
              <video
                ref={videoRef} playsInline muted
                className="h-full w-full -scale-x-100 object-cover"
              />

              {/* Face boxes sit in the same coordinate space as the video. */}
              {running && faces.map((face, index) => (
                <FaceBox key={face.event_id ?? index} face={face} />
              ))}

              {videoError && !cameraReady && (
                <div className="absolute inset-0 flex items-center justify-center p-6">
                  <p className="text-center text-sm text-muted-foreground">{videoError}</p>
                </div>
              )}

              {cameraReady && (
                <div className="absolute right-3 top-3">
                  <LiveClock />
                </div>
              )}

              {running && (
                <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white">
                  <span className={cn(
                    'h-2 w-2 rounded-full bg-destructive',
                    posting ? 'animate-none' : 'animate-pulse',
                  )} />
                  {posting ? 'Sending…' : 'Live'}
                </div>
              )}

              {/* Result overlay, so somebody at the door sees the outcome. */}
              {last && running && !faces.length && (
                <div className="absolute inset-x-3 bottom-3 animate-in">
                  <div className={cn(
                    'flex items-center gap-3 rounded-lg p-3 backdrop-blur',
                    last.decision === 'matched' ? 'bg-success/90 text-success-foreground'
                      : last.decision === 'duplicate' ? 'bg-info/90 text-info-foreground'
                      : last.decision === 'no_match' ? 'bg-destructive/90 text-destructive-foreground'
                      : 'bg-black/75 text-white',
                  )}>
                    <DecisionIcon className="h-6 w-6 shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">
                        {last.employee?.name ?? decision.label}
                      </p>
                      <p className="truncate text-xs opacity-90">
                        {action?.label ? `${action.label} · ` : ''}{last.message}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {!apiKey && cameraId && (
              <p className="text-sm text-muted-foreground">Fetching the device key…</p>
            )}
            {!cameraId && (
              <div className="flex items-start gap-2.5 rounded-md bg-info/10 p-3 text-sm text-info">
                <Video className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Choose which camera this device should act as. Attendance is
                  recorded against that camera, using its entry/exit direction.
                </p>
              </div>
            )}
            {selected && !selected.is_active && (
              <div className="flex items-start gap-2.5 rounded-md bg-warning/10 p-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>This camera is disabled, so the server will reject its frames.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Recent</p>
              {log.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setLog([])}>Clear</Button>
              )}
            </div>

            {log.length ? (
              <ul className="space-y-2">
                {log.map((entry, index) => {
                  const spec = DECISION[entry.decision] ?? DECISION.no_face
                  return (
                    <li
                      key={`${entry.id ?? 'x'}-${index}`}
                      className="flex items-center gap-3 rounded-md border border-border p-2.5"
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-[10px]">
                          {entry.employee ? initials(entry.employee.name) : '?'}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {entry.employee?.name ?? 'Unknown face'}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {formatTime(entry.at)}
                          {entry.confidence
                            ? ` · ${(entry.confidence * 100).toFixed(0)}%`
                            : ''}
                        </p>
                      </div>
                      <Badge tone={spec.tone}>{spec.label}</Badge>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="py-10 text-center">
                {running ? (
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                ) : (
                  <CameraIcon className="mx-auto h-6 w-6 text-muted-foreground" />
                )}
                <p className="mt-2 text-sm text-muted-foreground">
                  {running ? 'Watching for faces…' : 'Press Start to begin.'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
