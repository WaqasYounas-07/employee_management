import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Clock, Send, Trash2, UserPlus, X } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useAuth } from '@/features/auth/auth-context'
import { formatDateTime, initials, timeAgo } from '@/lib/format'
import { TASK_PRIORITY, TASK_STATUS, ACTIVITY_LABEL } from './board-constants'

const BLANK = {
  title: '', description: '', priority: 'medium', status: 'open',
  due_date: '', estimated_hours: '', labels: [],
}

/**
 * Create a card (pass `board` and `column`) or open an existing one
 * (pass `task`). Editing, commenting and the activity trail live together,
 * because they are all "what is going on with this card".
 */
export function TaskDialog({ task, open, onOpenChange, board, column, onChanged }) {
  const editing = Boolean(task)
  const queryClient = useQueryClient()
  const { can, user } = useAuth()

  const [form, setForm] = useState(BLANK)
  const [labelDraft, setLabelDraft] = useState('')
  const [comment, setComment] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const ownEmployeeId = user?.employee?.id
  const isMine = task?.assignee_details?.some((a) => a.id === ownEmployeeId)
  const mayEdit = can('manage_tasks') || Boolean(isMine)
  const mayAssign = can('assign_tasks')
  const mayDelete = can('manage_tasks')

  useEffect(() => {
    if (!open) return
    setComment('')
    setLabelDraft('')
    setForm(task ? {
      ...BLANK, ...task,
      due_date: task.due_date ?? '',
      estimated_hours: task.estimated_hours ?? '',
      labels: task.labels ?? [],
    } : BLANK)
  }, [open, task])

  const { data: employees } = useQuery({
    queryKey: ['employees', 'picker'],
    queryFn: async () => (await api.get('/employees/', { params: { page_size: 200 } })).data,
    enabled: open,
  })

  const { data: comments } = useQuery({
    queryKey: ['task-comments', task?.id],
    queryFn: async () => (await api.get(`/tasks/${task.id}/comments/`)).data,
    enabled: Boolean(open && task?.id),
  })

  const { data: activity } = useQuery({
    queryKey: ['task-activity', task?.id],
    queryFn: async () => (await api.get(`/tasks/${task.id}/activity/`)).data,
    enabled: Boolean(open && task?.id),
  })

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title,
        description: form.description,
        priority: form.priority,
        status: form.status,
        labels: form.labels,
        due_date: form.due_date || null,
        estimated_hours: form.estimated_hours === '' ? null : form.estimated_hours,
      }
      if (editing) return (await api.patch(`/tasks/${task.id}/`, payload)).data
      return (await api.post('/tasks/', {
        ...payload, board: board.id, column: column.id,
      })).data
    },
    onSuccess: () => {
      toast.success(editing ? 'Task updated.' : 'Task created.')
      onChanged?.()
      onOpenChange(false)
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not save the task.')),
  })

  const assign = useMutation({
    mutationFn: async (ids) =>
      (await api.post(`/tasks/${task.id}/assign/`, { employees: ids })).data,
    onSuccess: () => {
      toast.success('Assignees updated.')
      queryClient.invalidateQueries({ queryKey: ['task-activity', task.id] })
      onChanged?.()
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not assign that person.')),
  })

  const addComment = useMutation({
    mutationFn: async () =>
      (await api.post(`/tasks/${task.id}/comments/`, { body: comment })).data,
    onSuccess: () => {
      setComment('')
      queryClient.invalidateQueries({ queryKey: ['task-comments', task.id] })
      queryClient.invalidateQueries({ queryKey: ['task-activity', task.id] })
      onChanged?.()
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not post that comment.')),
  })

  const remove = useMutation({
    mutationFn: async () => api.delete(`/tasks/${task.id}/`),
    onSuccess: () => {
      toast.success('Task deleted.')
      setConfirmDelete(false)
      onChanged?.()
      onOpenChange(false)
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not delete the task.')),
  })

  const assigned = task?.assignee_details ?? []
  const assignedIds = assigned.map((a) => a.id)
  const available = (employees?.results ?? []).filter((e) => !assignedIds.includes(e.id))

  const addLabel = () => {
    const value = labelDraft.trim()
    if (!value || form.labels.includes(value)) return
    setForm((f) => ({ ...f, labels: [...f.labels, value] }))
    setLabelDraft('')
  }

  const details = (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="title">Title <span className="text-destructive">*</span></Label>
        <Input
          id="title" value={form.title} required disabled={!mayEdit}
          placeholder="What needs doing?"
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description" rows={4} value={form.description} disabled={!mayEdit}
          placeholder="Context, acceptance criteria, links…"
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Priority</Label>
          <Select
            value={form.priority} disabled={!mayEdit}
            onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(TASK_PRIORITY).map(([value, { label }]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select
            value={form.status} disabled={!mayEdit}
            onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(TASK_STATUS).map(([value, { label }]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {editing && (
            <p className="text-[11px] text-muted-foreground">
              Moving the card between columns also sets this.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="due">Due date</Label>
          <Input
            id="due" type="date" value={form.due_date} disabled={!mayEdit}
            onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="hours">Estimate (hours)</Label>
          <Input
            id="hours" type="number" min="0" step="0.5" disabled={!mayEdit}
            value={form.estimated_hours}
            onChange={(e) => setForm((f) => ({ ...f, estimated_hours: e.target.value }))}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Labels</Label>
        <div className="flex flex-wrap gap-1.5">
          {form.labels.map((label) => (
            <Badge key={label} tone="outline" className="gap-1">
              {label}
              {mayEdit && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({
                    ...f, labels: f.labels.filter((l) => l !== label),
                  }))}
                  className="hover:text-destructive"
                  aria-label={`Remove ${label}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
          {!form.labels.length && (
            <span className="text-xs text-muted-foreground">None yet.</span>
          )}
        </div>
        {mayEdit && (
          <div className="flex gap-2">
            <Input
              value={labelDraft} placeholder="Add a label"
              onChange={(e) => setLabelDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addLabel() }
              }}
            />
            <Button type="button" variant="outline" onClick={addLabel}>Add</Button>
          </div>
        )}
      </div>

      {editing && (
        <>
          <Separator />
          <div className="space-y-2">
            <Label>Assigned to</Label>
            <div className="flex flex-wrap gap-2">
              {assigned.map((person) => (
                <span
                  key={person.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border py-0.5 pl-0.5 pr-2 text-xs"
                >
                  <Avatar className="h-5 w-5">
                    {person.photo && <AvatarImage src={person.photo} alt="" />}
                    <AvatarFallback className="text-[9px]">
                      {initials(person.name)}
                    </AvatarFallback>
                  </Avatar>
                  {person.name}
                  {mayAssign && (
                    <button
                      type="button"
                      onClick={() => assign.mutate(assignedIds.filter((x) => x !== person.id))}
                      className="hover:text-destructive"
                      aria-label={`Unassign ${person.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
              {!assigned.length && (
                <span className="text-xs text-muted-foreground">Nobody yet.</span>
              )}
            </div>

            {mayAssign && available.length > 0 && (
              <Select onValueChange={(v) => assign.mutate([...assignedIds, Number(v)])}>
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue placeholder="Assign someone…" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.full_name} ({e.employee_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </>
      )}
    </div>
  )

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Task' : 'New task'}</DialogTitle>
            <DialogDescription>
              {editing
                ? `In ${task.column_name} on ${task.board_name}.`
                : `It will be added to ${column?.name ?? 'the first column'}.`}
            </DialogDescription>
          </DialogHeader>

          {editing ? (
            <Tabs defaultValue="details">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="comments">
                  Comments{comments?.length ? ` (${comments.length})` : ''}
                </TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>

              <TabsContent value="details">{details}</TabsContent>

              <TabsContent value="comments" className="space-y-3">
                <ul className="max-h-64 space-y-3 overflow-y-auto">
                  {comments?.length ? comments.map((item) => (
                    <li key={item.id} className="rounded-md border border-border p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-medium">{item.author_name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {timeAgo(item.created_at)}
                        </p>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{item.body}</p>
                    </li>
                  )) : (
                    <li className="py-6 text-center text-sm text-muted-foreground">
                      No comments yet.
                    </li>
                  )}
                </ul>

                <div className="flex gap-2">
                  <Textarea
                    rows={2} value={comment} placeholder="Write a comment…"
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <Button
                    onClick={() => addComment.mutate()}
                    disabled={!comment.trim()}
                    loading={addComment.isPending}
                  >
                    <Send />
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="activity">
                <ul className="max-h-72 space-y-2 overflow-y-auto">
                  {activity?.length ? activity.map((item) => (
                    <li key={item.id} className="flex items-start gap-2.5 text-sm">
                      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p>
                          <span className="font-medium">{item.actor_name}</span>{' '}
                          <span className="text-muted-foreground">
                            {ACTIVITY_LABEL[item.action] ?? item.action}
                          </span>
                          {item.detail && (
                            <span className="text-muted-foreground"> — {item.detail}</span>
                          )}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDateTime(item.created_at)}
                        </p>
                      </div>
                    </li>
                  )) : (
                    <li className="py-6 text-center text-sm text-muted-foreground">
                      Nothing recorded yet.
                    </li>
                  )}
                </ul>
              </TabsContent>
            </Tabs>
          ) : (
            details
          )}

          <DialogFooter className="sm:justify-between">
            {editing && mayDelete ? (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 /> Delete
              </Button>
            ) : <span />}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              {mayEdit && (
                <Button
                  onClick={() => save.mutate()}
                  disabled={!form.title.trim()}
                  loading={save.isPending}
                >
                  {editing ? 'Save changes' : 'Create task'}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this task?"
        description="The card, its comments and its history are removed. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}
