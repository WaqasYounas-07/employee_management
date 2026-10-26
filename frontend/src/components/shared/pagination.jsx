import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Pagination({ page, count, pageSize = 25, onChange }) {
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / pageSize))
  if (!count || totalPages <= 1) return null

  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, count)

  return (
    <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">{from}–{to}</span> of{' '}
        <span className="font-medium text-foreground tabular-nums">{count}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline" size="sm"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft /> Previous
        </Button>
        <span className="px-1 text-sm text-muted-foreground tabular-nums">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline" size="sm"
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
        >
          Next <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
