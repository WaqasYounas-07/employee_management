import { CalendarDays, MessageSquare, Paperclip } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatDate, initials } from '@/lib/format'
import { TASK_PRIORITY } from './board-constants'

/**
 * One card. Draggable when the viewer may move it -- the board decides that,
 * since the API allows an assignee to move their own card without holding
 * `manage_tasks`.
 */
export function TaskCard({ task, onOpen, draggable, onDragStart, onDragEnd, dragging }) {
  const priority = TASK_PRIORITY[task.priority] ?? TASK_PRIORITY.medium
  const assignees = task.assignee_details ?? []

  return (
    <article
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', String(task.id))
        onDragStart?.(task)
      }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen?.(task)}
      className={cn(
        'group cursor-pointer rounded-lg border border-border bg-card p-3 shadow-sm transition-all',
        'hover:border-primary/40 hover:shadow-md',
        draggable && 'active:cursor-grabbing',
        dragging && 'opacity-40',
        task.is_overdue && 'border-destructive/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{task.title}</p>
        <span
          className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', priority.dot)}
          title={`${priority.label} priority`}
        />
      </div>

      {Boolean(task.labels?.length) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.slice(0, 3).map((label) => (
            <Badge key={label} tone="outline" className="px-1.5 py-0 text-[10px]">
              {label}
            </Badge>
          ))}
          {task.labels.length > 3 && (
            <Badge tone="muted" className="px-1.5 py-0 text-[10px]">
              +{task.labels.length - 3}
            </Badge>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
          {task.due_date && (
            <span
              className={cn(
                'inline-flex items-center gap-1',
                task.is_overdue && 'font-medium text-destructive',
              )}
            >
              <CalendarDays className="h-3 w-3" />
              {formatDate(task.due_date, 'd MMM')}
            </span>
          )}
          {task.comment_count > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {task.comment_count}
            </span>
          )}
          {Boolean(task.estimated_hours) && (
            <span className="inline-flex items-center gap-1">
              <Paperclip className="h-3 w-3" />
              {task.estimated_hours}h
            </span>
          )}
        </div>

        {/* Stacked avatars, newest overlapping — the usual board convention. */}
        {assignees.length > 0 && (
          <div className="flex -space-x-1.5">
            {assignees.slice(0, 3).map((person) => (
              <Avatar
                key={person.id}
                className="h-6 w-6 border-2 border-card"
                title={person.name}
              >
                {person.photo && <AvatarImage src={person.photo} alt="" />}
                <AvatarFallback className="text-[9px]">
                  {initials(person.name)}
                </AvatarFallback>
              </Avatar>
            ))}
            {assignees.length > 3 && (
              <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-card bg-muted text-[9px] font-medium">
                +{assignees.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
