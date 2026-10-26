import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ListTodo, AlertTriangle, CheckCircle2, Columns3 } from 'lucide-react'
import { api } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import { DataTable } from '@/components/shared/data-table'
import { StatCard } from '@/components/shared/stat-card'
import { StatusBadge } from '@/components/shared/status-badge'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { TASK_PRIORITY, TASK_STATUS } from './board-constants'
import { TaskDialog } from './task-dialog'

/** Everything assigned to the signed-in user, across every board. */
export function MyTasksPage() {
  const queryClient = useQueryClient()
  const [view, setView] = useState('open')
  const [openTask, setOpenTask] = useState(null)

  const params = {
    mine: 'true',
    page_size: 100,
    ...(view === 'overdue' ? { overdue: 'true' } : {}),
    ...(view === 'done' ? { status: 'done' } : {}),
  }

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', 'mine', params],
    queryFn: async () => (await api.get('/tasks/', { params })).data,
  })

  const { data: summary } = useQuery({
    queryKey: ['task-summary'],
    queryFn: async () => (await api.get('/tasks/my-summary/')).data,
  })

  // "Open" means still outstanding, which the API expresses per status.
  const rows = (data?.results ?? []).filter((task) =>
    view === 'open' ? !['done', 'cancelled'].includes(task.status) : true,
  )

  const columns = [
    {
      key: 'title', header: 'Task',
      cell: (task) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{task.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {task.board_name} · {task.column_name}
          </p>
        </div>
      ),
    },
    {
      key: 'priority', header: 'Priority',
      cell: (task) => {
        const spec = TASK_PRIORITY[task.priority] ?? TASK_PRIORITY.medium
        return (
          <span className="inline-flex items-center gap-1.5 text-sm">
            <span className={cn('h-2 w-2 rounded-full', spec.dot)} />
            {spec.label}
          </span>
        )
      },
    },
    {
      key: 'due_date', header: 'Due', className: 'tabular-nums',
      cell: (task) => (
        <span className={cn(task.is_overdue && 'font-medium text-destructive')}>
          {task.due_date ? formatDate(task.due_date) : '—'}
        </span>
      ),
    },
    {
      key: 'status', header: 'Status',
      cell: (task) => {
        const spec = TASK_STATUS[task.status] ?? TASK_STATUS.open
        return <Badge tone={spec.tone}>{spec.label}</Badge>
      },
    },
    {
      key: 'actions', header: '', className: 'text-right',
      cell: (task) => (
        <Button variant="ghost" size="sm" asChild onClick={(e) => e.stopPropagation()}>
          <Link to={`/boards/${task.board}`}>Open board</Link>
        </Button>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="My tasks"
        description="Everything assigned to you, across every board."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Assigned" value={summary?.assigned ?? 0} icon={ListTodo} loading={!summary} />
        <StatCard label="In progress" value={summary?.in_progress ?? 0} icon={Columns3} tone="info" loading={!summary} />
        <StatCard label="Overdue" value={summary?.overdue ?? 0} icon={AlertTriangle} tone="destructive" loading={!summary} />
        <StatCard label="Completed" value={summary?.done ?? 0} icon={CheckCircle2} tone="success" loading={!summary} />
      </div>

      <Card>
        <CardContent className="p-4 sm:p-5">
          <Tabs value={view} onValueChange={setView}>
            <TabsList>
              <TabsTrigger value="open">Open</TabsTrigger>
              <TabsTrigger value="overdue">Overdue</TabsTrigger>
              <TabsTrigger value="done">Completed</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>

        <DataTable
          columns={columns} rows={rows} loading={isLoading}
          onRowClick={setOpenTask}
          empty={{
            icon: ListTodo,
            title: view === 'overdue' ? 'Nothing overdue' : 'No tasks here',
            description: 'Cards assigned to you appear here.',
          }}
        />
      </Card>

      <TaskDialog
        task={openTask}
        open={Boolean(openTask)}
        onOpenChange={(open) => !open && setOpenTask(null)}
        onChanged={() => {
          queryClient.invalidateQueries({ queryKey: ['tasks'] })
          queryClient.invalidateQueries({ queryKey: ['task-summary'] })
        }}
      />
    </>
  )
}
