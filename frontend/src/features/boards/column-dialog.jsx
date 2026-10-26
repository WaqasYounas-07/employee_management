import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

/** Add, reorder, cap and remove a board's columns. */
export function ColumnDialog({ open, onOpenChange, board, onChanged }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [isDone, setIsDone] = useState(false)
  const [wipLimit, setWipLimit] = useState('0')

  const columns = board?.columns ?? []

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['board', String(board.id)] })
    onChanged?.()
  }

  const addColumn = useMutation({
    mutationFn: async () => (await api.post(`/boards/${board.id}/columns/`, {
      name, is_done_column: isDone, wip_limit: Number(wipLimit) || 0,
    })).data,
    onSuccess: () => {
      toast.success('Column added.')
      setName(''); setIsDone(false); setWipLimit('0')
      refresh()
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not add the column.')),
  })

  const updateColumn = useMutation({
    mutationFn: async ({ id, ...patch }) =>
      (await api.patch(`/board-columns/${id}/`, patch)).data,
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error, 'Could not update the column.')),
  })

  const removeColumn = useMutation({
    mutationFn: async (id) => api.delete(`/board-columns/${id}/`),
    onSuccess: () => { toast.success('Column removed.'); refresh() },
    // The API refuses while cards remain, and says so.
    onError: (error) => toast.error(errorMessage(error, 'Could not remove the column.')),
  })

  const reorder = useMutation({
    mutationFn: async (ids) =>
      (await api.post(`/boards/${board.id}/reorder-columns/`, { columns: ids })).data,
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error, 'Could not reorder columns.')),
  })

  const shift = (index, direction) => {
    const ids = columns.map((c) => c.id)
    const target = index + direction
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    reorder.mutate(ids)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Columns</DialogTitle>
          <DialogDescription>
            The order here is the order on the board. Cards in the “done”
            column are marked complete automatically.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2">
          {columns.map((column, index) => (
            <li
              key={column.id}
              className="flex items-center gap-2 rounded-md border border-border p-2.5"
            >
              <div className="flex flex-col">
                <Button
                  variant="ghost" size="icon" className="h-5 w-5"
                  aria-label={`Move ${column.name} left`}
                  onClick={() => shift(index, -1)}
                  disabled={index === 0 || reorder.isPending}
                >
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost" size="icon" className="h-5 w-5"
                  aria-label={`Move ${column.name} right`}
                  onClick={() => shift(index, 1)}
                  disabled={index === columns.length - 1 || reorder.isPending}
                >
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{column.name}</p>
                  {column.is_done_column && <Badge tone="success">done</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {column.task_count ?? column.tasks?.length ?? 0} card(s)
                  {column.wip_limit > 0 && ` · limit ${column.wip_limit}`}
                </p>
              </div>

              <Input
                type="number" min="0" className="h-8 w-16"
                defaultValue={column.wip_limit}
                title="Work-in-progress limit; 0 means none"
                onBlur={(e) => {
                  const next = Number(e.target.value) || 0
                  if (next !== column.wip_limit) {
                    updateColumn.mutate({ id: column.id, wip_limit: next })
                  }
                }}
              />

              <Button
                variant="ghost" size="icon"
                aria-label={`Delete ${column.name}`}
                onClick={() => removeColumn.mutate(column.id)}
                disabled={removeColumn.isPending}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>

        <Separator />

        <div className="space-y-3">
          <p className="text-sm font-medium">Add a column</p>
          <div className="flex gap-2">
            <Input
              placeholder="Column name" value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              type="number" min="0" className="w-20" value={wipLimit}
              title="Work-in-progress limit"
              onChange={(e) => setWipLimit(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-2.5">
            <div>
              <Label htmlFor="done-col">Completes a task</Label>
              <p className="text-xs text-muted-foreground">
                Cards dropped here are marked done.
              </p>
            </div>
            <Switch id="done-col" checked={isDone} onCheckedChange={setIsDone} />
          </div>
          <Button
            className="w-full"
            onClick={() => addColumn.mutate()}
            disabled={!name.trim()}
            loading={addColumn.isPending}
          >
            <Plus /> Add column
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
