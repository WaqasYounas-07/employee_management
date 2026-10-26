import { cn } from '@/lib/utils'

const Table = ({ className, ...props }) => (
  <div className="relative w-full max-w-full overflow-x-auto">
    <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
  </div>
)

const TableHeader = ({ className, ...props }) => (
  <thead className={cn('[&_tr]:border-b', className)} {...props} />
)

const TableBody = ({ className, ...props }) => (
  <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
)

const TableFooter = ({ className, ...props }) => (
  <tfoot className={cn('border-t bg-muted/50 font-medium', className)} {...props} />
)

const TableRow = ({ className, ...props }) => (
  <tr
    className={cn('border-b border-border transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted', className)}
    {...props}
  />
)

const TableHead = ({ className, ...props }) => (
  <th
    className={cn(
      'h-10 whitespace-nowrap px-4 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground',
      className,
    )}
    {...props}
  />
)

const TableCell = ({ className, ...props }) => (
  <td className={cn('px-4 py-3 align-middle', className)} {...props} />
)

const TableCaption = ({ className, ...props }) => (
  <caption className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
)

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }
