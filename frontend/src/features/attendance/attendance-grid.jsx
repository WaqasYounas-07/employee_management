import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Check, X, Clock, CircleSlash, Minus, Plane,
  ChevronLeft, ChevronRight, Search, Users,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/empty-state'
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatHours, formatTime, initials, toISODate } from '@/lib/format'
import { useDebounce } from '@/hooks/use-debounce'

/* One visual language for a day cell, keyed by the backend's status. */
const CELL = {
  present:  { icon: Check,       label: 'Present',  dot: 'bg-success/15 text-success' },
  late:     { icon: Clock,       label: 'Late',     dot: 'bg-warning/18 text-warning' },
  half_day: { icon: Minus,       label: 'Half day', dot: 'bg-info/15 text-info' },
  absent:   { icon: X,           label: 'Absent',   dot: 'bg-destructive/15 text-destructive' },
  on_leave: { icon: Plane,       label: 'On leave', dot: 'bg-info/15 text-info' },
  holiday:  { icon: CircleSlash, label: 'Holiday',  dot: 'bg-muted text-muted-foreground' },
}

/** Filter chips across the top, each with a live count. */
const FILTERS = [
  { key: 'all',      label: 'All',      dot: 'bg-muted-foreground' },
  { key: 'present',  label: 'Attended', dot: 'bg-success' },
  { key: 'absent',   label: 'Absent',   dot: 'bg-destructive' },
  { key: 'late',     label: 'Late',     dot: 'bg-warning' },
  { key: 'on_leave', label: 'Time off', dot: 'bg-info' },
]

function monthRange(offset = 0) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  return { start: toISODate(start), end: toISODate(end), label: start }
}

function DayCell({ cell, day }) {
  // Nothing recorded. A future date is simply not here yet; a past one was
  // never swept, which is not the same as a recorded absence.
  if (!cell) {
    return (
      <div className="flex h-9 items-center justify-center">
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            day.is_future ? 'bg-transparent' : 'bg-border',
          )}
        />
      </div>
    )
  }

  const spec = CELL[cell.status] ?? CELL.holiday
  const Icon = spec.icon

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex h-9 items-center justify-center">
          <span
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110',
              spec.dot,
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={3} />
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-medium">{spec.label}</p>
        {cell.check_in && (
          <p className="text-[11px] opacity-80">
            {formatTime(cell.check_in)}
            {cell.check_out ? ` – ${formatTime(cell.check_out)}` : ''}
            {Number(cell.worked_hours) > 0 && ` · ${formatHours(cell.worked_hours)}`}
          </p>
        )}
        {cell.late_minutes > 0 && (
          <p className="text-[11px] opacity-80">{cell.late_minutes} min late</p>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

export function AttendanceGrid({ department, onPickEmployee }) {
  const [offset, setOffset] = useState(0)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search)

  const range = useMemo(() => monthRange(offset), [offset])

  const params = {
    start: range.start,
    end: range.end,
    department: department || undefined,
    search: debounced || undefined,
  }

  const { data, isLoading } = useQuery({
    queryKey: ['attendance', 'matrix', params],
    queryFn: async () => (await api.get('/attendance/matrix/', { params })).data,
    placeholderData: (prev) => prev,
  })

  const days = useMemo(() => data?.days ?? [], [data])
  const allRows = useMemo(() => data?.rows ?? [], [data])

  /* Chip counts come from the whole month, so they do not change as the
     chips themselves filter the rows. */
  const counts = useMemo(() => {
    const totals = { all: allRows.length, present: 0, absent: 0, late: 0, on_leave: 0 }
    for (const row of allRows) {
      for (const key of ['present', 'absent', 'late', 'on_leave']) {
        if (row.summary[key] > 0) totals[key] += 1
      }
    }
    return totals
  }, [allRows])

  const rows = useMemo(() => {
    if (filter === 'all') return allRows
    return allRows.filter((row) => row.summary[filter] > 0)
  }, [allRows, filter])

  const monthLabel = range.label.toLocaleString(undefined, {
    month: 'long', year: 'numeric',
  })

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline" size="icon"
            onClick={() => setOffset((o) => o - 1)}
            aria-label="Previous month"
          >
            <ChevronLeft />
          </Button>
          <div className="min-w-44 text-center text-sm font-semibold">{monthLabel}</div>
          <Button
            variant="outline" size="icon"
            onClick={() => setOffset((o) => o + 1)}
            disabled={offset >= 0}
            aria-label="Next month"
          >
            <ChevronRight />
          </Button>
          {offset !== 0 && (
            <Button variant="ghost" size="sm" onClick={() => setOffset(0)}>
              This month
            </Button>
          )}
        </div>

        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search employee…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((chip) => (
          <button
            key={chip.key}
            onClick={() => setFilter(chip.key)}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              filter === chip.key
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', chip.dot)} />
            {chip.label}
            <span className="tabular-nums opacity-70">{counts[chip.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="overflow-hidden rounded-lg border border-border">
        {isLoading && !data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length ? (
          <div className="flex">
            {/* Frozen name column: the grid is wide, and a row is unreadable
                once its name scrolls away. */}
            <div className="shrink-0 border-r border-border bg-card">
              <div className="flex h-11 items-center border-b border-border px-3 sm:px-4">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Employee
                </span>
              </div>
              {rows.map((row) => (
                <div
                  key={row.employee.id}
                  className="flex h-12 w-40 items-center gap-2.5 border-b border-border px-3 last:border-b-0 sm:w-60 sm:px-4"
                >
                  <Avatar className="h-7 w-7 shrink-0">
                    {row.employee.photo && <AvatarImage src={row.employee.photo} alt="" />}
                    <AvatarFallback className="text-[10px]">
                      {initials(row.employee.name)}
                    </AvatarFallback>
                  </Avatar>
                  <button
                    onClick={() => onPickEmployee?.(row.employee)}
                    className="min-w-0 text-left hover:underline"
                  >
                    <p className="truncate text-sm font-medium leading-tight">
                      {row.employee.name}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {row.employee.code}
                    </p>
                  </button>
                </div>
              ))}
            </div>

            {/* Scrolling day columns */}
            <div className="min-w-0 flex-1 overflow-x-auto">
              <div className="min-w-max">
                <div className="flex h-11 border-b border-border">
                  {days.map((day) => (
                    <div
                      key={day.date}
                      className={cn(
                        'flex w-11 shrink-0 flex-col items-center justify-center',
                        (day.is_weekend || day.is_holiday) && 'bg-muted/40',
                      )}
                    >
                      <span className="text-[10px] uppercase text-muted-foreground">
                        {day.weekday}
                      </span>
                      <span className="text-xs font-semibold tabular-nums">{day.day}</span>
                    </div>
                  ))}
                </div>

                {rows.map((row) => (
                  <div key={row.employee.id} className="flex h-12 border-b border-border last:border-b-0">
                    {days.map((day) => (
                      <div
                        key={day.date}
                        className={cn(
                          'flex w-11 shrink-0 items-center justify-center',
                          (day.is_weekend || day.is_holiday) && 'bg-muted/40',
                        )}
                      >
                        <DayCell cell={row.days[day.date]} day={day} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={Users}
            title="No employees match"
            description={
              debounced
                ? 'Try a different search.'
                : 'Nobody to show for this month and filter.'
            }
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        {Object.entries(CELL).map(([key, spec]) => {
          const Icon = spec.icon
          return (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span className={cn('flex h-4 w-4 items-center justify-center rounded-full', spec.dot)}>
                <Icon className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
              {spec.label}
            </span>
          )
        })}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-border" />
          No record
        </span>
      </div>
    </div>
  )
}
