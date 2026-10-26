/* Mirrors the tasks app's TextChoices, so a card renders the same way
   everywhere it appears. */

export const TASK_PRIORITY = {
  low:    { label: 'Low',    tone: 'muted',       dot: 'bg-muted-foreground' },
  medium: { label: 'Medium', tone: 'info',        dot: 'bg-info' },
  high:   { label: 'High',   tone: 'warning',     dot: 'bg-warning' },
  urgent: { label: 'Urgent', tone: 'destructive', dot: 'bg-destructive' },
}

export const TASK_STATUS = {
  open:        { label: 'Open',        tone: 'muted' },
  in_progress: { label: 'In progress', tone: 'info' },
  blocked:     { label: 'Blocked',     tone: 'destructive' },
  done:        { label: 'Done',        tone: 'success' },
  cancelled:   { label: 'Cancelled',   tone: 'muted' },
}

export const ACTIVITY_LABEL = {
  created: 'created this task',
  moved: 'moved it',
  assigned: 'assigned',
  unassigned: 'unassigned',
  updated: 'updated it',
  commented: 'commented',
  completed: 'completed it',
  reopened: 'reopened it',
}
