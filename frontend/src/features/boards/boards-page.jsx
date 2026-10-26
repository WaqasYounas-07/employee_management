import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Archive, Columns3, KanbanSquare, ListTodo, Plus, AlertTriangle, CheckCircle2,
} from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import { StatCard } from '@/components/shared/stat-card'
import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/features/auth/auth-context'

const NONE = '__none__'

export function BoardsPage() {
  const queryClient = useQueryClient()
  const { can } = useAuth()
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', department: NONE })

  const { data: boards, isLoading } = useQuery({
    queryKey: ['boards'],
    queryFn: async () => (await api.get('/boards/', { params: { page_size: 100 } })).data,
  })

  const { data: summary } = useQuery({
    queryKey: ['task-summary'],
    queryFn: async () => (await api.get('/tasks/my-summary/')).data,
  })

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => (await api.get('/departments/', { params: { page_size: 100 } })).data,
    enabled: creating,
  })

  const create = useMutation({
    mutationFn: async () => (await api.post('/boards/', {
      name: form.name,
      description: form.description,
      department: form.department === NONE ? null : Number(form.department),
    })).data,
    onSuccess: () => {
      toast.success('Board created with its default columns.')
      setForm({ name: '', description: '', department: NONE })
      setCreating(false)
      queryClient.invalidateQueries({ queryKey: ['boards'] })
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not create the board.')),
  })

  const rows = boards?.results ?? []

  return (
    <>
      <PageHeader
        title="Boards"
        description="Kanban boards for planning work and assigning it to people."
      >
        {can('manage_boards') && (
          <Button onClick={() => setCreating(true)}><Plus /> New board</Button>
        )}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Assigned to me" value={summary?.assigned ?? 0}
          icon={ListTodo} tone="default" loading={!summary}
        />
        <StatCard
          label="In progress" value={summary?.in_progress ?? 0}
          icon={Columns3} tone="info" loading={!summary}
        />
        <StatCard
          label="Overdue" value={summary?.overdue ?? 0}
          hint="past their due date" icon={AlertTriangle}
          tone="destructive" loading={!summary}
        />
        <StatCard
          label="Completed" value={summary?.done ?? 0}
          icon={CheckCircle2} tone="success" loading={!summary}
        />
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : rows.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((board) => (
            <Link key={board.id} to={`/boards/${board.id}`}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <KanbanSquare className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{board.name}</p>
                        {board.department_name && (
                          <p className="truncate text-xs text-muted-foreground">
                            {board.department_name}
                          </p>
                        )}
                      </div>
                    </div>
                    {board.is_archived && <Badge tone="muted"><Archive className="mr-1 h-3 w-3" />Archived</Badge>}
                  </div>

                  {board.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {board.description}
                    </p>
                  )}

                  <div className="flex gap-2">
                    <Badge tone="outline">{board.column_count} columns</Badge>
                    <Badge tone="muted">{board.task_count} cards</Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={KanbanSquare}
            title="No boards yet"
            description="A board holds columns of cards — the work your team is planning and doing."
            action={can('manage_boards') && (
              <Button onClick={() => setCreating(true)}><Plus /> Create a board</Button>
            )}
          />
        </Card>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New board</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); create.mutate() }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="board-name">Name <span className="text-destructive">*</span></Label>
              <Input
                id="board-name" required value={form.name}
                placeholder="Engineering Sprint"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="board-desc">Description</Label>
              <Textarea
                id="board-desc" rows={2} value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Select
                value={form.department}
                onValueChange={(v) => setForm((f) => ({ ...f, department: v }))}
              >
                <SelectTrigger><SelectValue placeholder="Any department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No department</SelectItem>
                  {(departments?.results ?? []).map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Optional. It starts with To do, In progress and Done columns.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!form.name.trim()} loading={create.isPending}>
                Create board
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
