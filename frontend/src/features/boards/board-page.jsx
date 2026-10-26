import { useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowLeft, Columns3, Plus, Search, Settings2,
} from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { EmptyState } from '@/components/shared/empty-state'
import { useAuth } from '@/features/auth/auth-context'
import { useDebounce } from '@/hooks/use-debounce'
import { cn } from '@/lib/utils'
import { TaskCard } from './task-card'
import { TaskDialog } from './task-dialog'
import { ColumnDialog } from './column-dialog'
import { TASK_PRIORITY } from './board-constants'

const ALL = '__all__'

export function BoardPage() {
  const { id } = useParams()
  const queryClient = useQueryClient()
  const { can, user } = useAuth()

  const canManageTasks = can('manage_tasks')
  const canManageBoards = can('manage_boards')

  const [search, setSearch] = useState('')
  const debounced = useDebounce(search)
  const [assignee, setAssignee] = useState(ALL)
  const [priority, setPriority] = useState(ALL)

  const [dragging, setDragging] = useState(null)
  //
  const draggingRef = useRef(null)
  const [overColumn, setOverColumn] = useState(null)
  const [openTask, setOpenTask] = useState(null)
  const [creatingIn, setCreatingIn] = useState(null)
  const [columnDialog, setColumnDialog] = useState(false)

  const params = {
    search: debounced || undefined,
    assignee: assignee === ALL ? undefined : assignee,
    priority: priority === ALL ? undefined : priority,
  }

  const { data: board, isLoading } = useQuery({
    queryKey: ['board', id, params],
    queryFn: async () => (await api.get(`/boards/${id}/`, { params })).data,
    placeholderData: (prev) => prev,
  })

  const { data: employees } = useQuery({
    queryKey: ['employees', 'picker'],
    queryFn: async () => (await api.get('/employees/', { params: { page_size: 200 } })).data,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['board', id] })

  /* The viewer's own employee id, so the board knows which cards they may
     drag without holding manage_tasks. */
  const ownEmployeeId = user?.employee?.id

  const mayMove = (task) =>
    canManageTasks ||
    (ownEmployeeId && task.assignee_details?.some((a) => a.id === ownEmployeeId))

  const move = useMutation({
    mutationFn: async ({ task, column, position }) =>
      (await api.post(`/tasks/${task.id}/move/`, { column, position })).data,
    onSuccess: refresh,
    onError: (error) => {
      toast.error(errorMessage(error, 'Could not move that card.'))
      refresh()
    },
  })

  const columns = useMemo(() => board?.columns ?? [], [board])
  const totalCards = useMemo(
    () => columns.reduce((sum, c) => sum + (c.tasks?.length ?? 0), 0),
    [columns],
  )

  const startDrag = (task) => {
    draggingRef.current = task
    setDragging(task)
  }

  const endDrag = () => {
    draggingRef.current = null
    setDragging(null)
    setOverColumn(null)
  }

  const onDrop = (column, index) => {
    setOverColumn(null)
    // Read and clear through the ref: state would not update until the next
    // render, so a nested drop in the same tick fired the move twice.
    const task = draggingRef.current
    draggingRef.current = null
    setDragging(null)
    if (!task) return
    // Dropping a card back where it already sits is not a move.
    if (task.column === column.id && index === undefined) return
    move.mutate({ task, column: column.id, position: index })
  }

  if (isLoading && !board) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="flex gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-96 w-72 shrink-0" />
          ))}
        </div>
      </div>
    )
  }

  if (!board) {
    return <p className="text-sm text-muted-foreground">Board not found.</p>
  }

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit">
        <Link to="/boards"><ArrowLeft /> All boards</Link>
      </Button>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{board.name}</h1>
            <Badge tone="muted">{totalCards} card{totalCards === 1 ? '' : 's'}</Badge>
            {board.department_name && (
              <Badge tone="outline">{board.department_name}</Badge>
            )}
          </div>
          {board.description && (
            <p className="text-sm text-muted-foreground">{board.description}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-52">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9" placeholder="Search cards…"
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <Select value={assignee} onValueChange={setAssignee}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Anyone" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Anyone</SelectItem>
              {(employees?.results ?? []).map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>{e.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Any priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any priority</SelectItem>
              {Object.entries(TASK_PRIORITY).map(([value, { label }]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {canManageBoards && (
            <Button variant="outline" onClick={() => setColumnDialog(true)}>
              <Settings2 /> Columns
            </Button>
          )}
          {canManageTasks && columns.length > 0 && (
            <Button onClick={() => setCreatingIn(columns[0])}>
              <Plus /> New task
            </Button>
          )}
        </div>
      </div>

      {columns.length === 0 ? (
        <Card>
          <EmptyState
            icon={Columns3}
            title="This board has no columns"
            description="Add a column before you can put cards on the board."
            action={canManageBoards && (
              <Button onClick={() => setColumnDialog(true)}><Plus /> Add column</Button>
            )}
          />
        </Card>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((column) => {
            const cards = column.tasks ?? []
            const full = column.wip_limit > 0 && cards.length >= column.wip_limit

            return (
              <section
                key={column.id}
                onDragOver={(e) => { e.preventDefault(); setOverColumn(column.id) }}
                onDragLeave={() => setOverColumn((c) => (c === column.id ? null : c))}
                onDrop={(e) => { e.preventDefault(); onDrop(column) }}
                className={cn(
                  'flex w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/30 transition-colors',
                  overColumn === column.id && 'border-primary bg-primary/5',
                )}
              >
                <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <h2 className="truncate text-sm font-semibold">{column.name}</h2>
                    <Badge tone={full ? 'warning' : 'muted'} className="px-1.5 py-0 text-[11px]">
                      {cards.length}{column.wip_limit > 0 && ` / ${column.wip_limit}`}
                    </Badge>
                  </div>
                  {canManageTasks && (
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7"
                      aria-label={`Add a card to ${column.name}`}
                      onClick={() => setCreatingIn(column)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  )}
                </header>

                {full && (
                  <div className="mx-3 mt-2 flex items-start gap-1.5 rounded bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
                    <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                    At its work-in-progress limit.
                  </div>
                )}

                <div className="flex-1 space-y-2 overflow-y-auto p-3">
                  {cards.length ? (
                    cards.map((task, index) => (
                      <div
                        key={task.id}
                        onDragOver={(e) => e.stopPropagation()}
                        onDrop={(e) => {
                          e.preventDefault(); e.stopPropagation()
                          onDrop(column, index)
                        }}
                      >
                        <TaskCard
                          task={task}
                          draggable={mayMove(task)}
                          dragging={dragging?.id === task.id}
                          onDragStart={startDrag}
                          onDragEnd={endDrag}
                          onOpen={setOpenTask}
                        />
                      </div>
                    ))
                  ) : (
                    <p className="py-8 text-center text-xs text-muted-foreground">
                      {overColumn === column.id ? 'Drop here' : 'No cards'}
                    </p>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <TaskDialog
        task={openTask}
        open={Boolean(openTask)}
        onOpenChange={(open) => !open && setOpenTask(null)}
        onChanged={refresh}
      />

      <TaskDialog
        open={Boolean(creatingIn)}
        onOpenChange={(open) => !open && setCreatingIn(null)}
        board={board}
        column={creatingIn}
        onChanged={refresh}
      />

      <ColumnDialog
        open={columnDialog}
        onOpenChange={setColumnDialog}
        board={board}
        onChanged={refresh}
      />
    </>
  )
}
