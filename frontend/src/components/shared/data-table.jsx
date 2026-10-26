import { Inbox } from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from './empty-state'
import { cn } from '@/lib/utils'

/**
 * A table driven by a column definition, so each feature describes its data
 * rather than repeating markup.
 *
 * columns: [{ key, header, cell?, className?, headClassName? }]
 */
export function DataTable({
  columns,
  rows = [],
  loading = false,
  skeletonRows = 6,
  onRowClick,
  empty = {},
  getRowId = (row, index) => row?.id ?? index,
}) {
  if (loading) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} className={column.headClassName}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: skeletonRows }).map((_, rowIndex) => (
            <TableRow key={rowIndex}>
              {columns.map((column) => (
                <TableCell key={column.key}>
                  <Skeleton className="h-4 w-full max-w-28" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  if (!rows.length) {
    return (
      <EmptyState
        icon={empty.icon ?? Inbox}
        title={empty.title ?? 'Nothing to show'}
        description={empty.description}
        action={empty.action}
      />
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.key} className={column.headClassName}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow
            key={getRowId(row, index)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(onRowClick && 'cursor-pointer')}
          >
            {columns.map((column) => (
              <TableCell key={column.key} className={column.className}>
                {column.cell ? column.cell(row) : (row[column.key] ?? '—')}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
