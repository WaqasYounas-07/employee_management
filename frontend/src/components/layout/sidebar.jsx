import { useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  BarChart3, Building2, CalendarCheck, CalendarDays, Camera, Clock, Home,
  LayoutDashboard, Minus, Palmtree, Plus, ScanFace, ScanSearch, Search,
  KanbanSquare, Settings, ShieldCheck, UserCog, Users, Video, Wrench, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/features/auth/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip'

/* The narrow rail. Each entry names a section of the nav panel, so the two
   columns stay in step: picking a rail icon scrolls its group into view. */
const RAIL = [
  { id: 'overview',    icon: Home,            label: 'Overview' },
  { id: 'people',      icon: Users,           label: 'People' },
  { id: 'work',        icon: KanbanSquare,    label: 'Work', perms: ['view_tasks'] },
  { id: 'recognition', icon: ScanFace,        label: 'Recognition',
    perms: ['view_cameras', 'view_recognition_log'] },
  { id: 'workspace',   icon: LayoutDashboard, label: 'Workspace' },
  { id: 'reports',     icon: BarChart3,       label: 'Reports',
    perms: ['view_reports'] },
  { id: 'system',      icon: Wrench,          label: 'System',
    perms: ['view_settings', 'view_permissions'] },
]

/* The nav panel. A group with `children` collapses; `end` marks an exact
   match so the index route does not stay highlighted everywhere. */
const NAV = [
  {
    id: 'overview',
    section: 'Overview',
    items: [
      { to: '/', label: 'Home', icon: Home, end: true },
      { to: '/attendance', label: 'Attendance', icon: CalendarCheck,
        perm: 'view_attendance' },
    ],
  },
  {
    id: 'people',
    section: 'People',
    items: [
      {
        to: '/employees', label: 'Employees', icon: Users, perm: 'view_employees',
        children: [
          { to: '/employees?status=active', label: 'Active' },
          { to: '/employees?enrolled=false', label: 'Not enrolled' },
          { to: '/employees?status=probation', label: 'Probation' },
        ],
      },
      { to: '/leave', label: 'Leave', icon: CalendarDays, perm: 'view_leave' },
    ],
  },
  {
    id: 'work',
    section: 'Work',
    perms: ['view_tasks'],
    items: [
      {
        to: '/boards', label: 'Boards', icon: KanbanSquare, perm: 'view_tasks',
        children: [
          { to: '/my-tasks', label: 'My tasks' },
        ],
      },
    ],
  },
  {
    id: 'recognition',
    section: 'Recognition',
    perms: ['view_cameras', 'view_recognition_log'],
    items: [
      { to: '/cameras', label: 'Cameras', icon: Camera, perm: 'view_cameras' },
      { to: '/live', label: 'Live camera', icon: Video, perm: 'view_cameras' },
      {
        to: '/recognition-events', label: 'Recognition log', icon: ScanSearch,
        perm: 'view_recognition_log',
      },
    ],
  },
  {
    id: 'system',
    section: 'System',
    perms: ['view_settings', 'view_permissions'],
    items: [
      {
        to: '/settings', label: 'Settings', icon: Settings,
        perm: 'view_settings',
        children: [
          { to: '/settings?tab=departments', label: 'Departments', icon: Building2 },
          { to: '/settings?tab=shifts', label: 'Shifts', icon: Clock },
          { to: '/settings?tab=leave-types', label: 'Leave types', icon: Palmtree },
          { to: '/settings?tab=holidays', label: 'Holidays', icon: CalendarDays },
        ],
      },
      { to: '/permissions', label: 'Permissions', icon: ShieldCheck,
        perm: 'view_permissions' },
      { to: '/my-profile', label: 'My profile', icon: UserCog },
    ],
  },
]

function RailButton({ entry, active, onClick }) {
  const Icon = entry.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          aria-label={entry.label}
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
            active
              ? 'bg-accent text-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{entry.label}</TooltipContent>
    </Tooltip>
  )
}

function NavItem({ item, onNavigate, forceOpen = false }) {
  const location = useLocation()
  const Icon = item.icon
  const hasChildren = Boolean(item.children?.length)

  // Open a group when the current route is inside it.
  const [open, setOpen] = useState(
    () => hasChildren && location.pathname.startsWith(item.to.split('?')[0]),
  )

  // While searching, a matched child must be visible even if the group was
  // closed; the toggle returns to manual control once the search clears.
  const expanded = forceOpen || open

  return (
    <li>
      <div className="flex items-center">
        <NavLink
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )
          }
        >
          {Icon && <Icon className="h-4 w-4 shrink-0" />}
          <span className="truncate">{item.label}</span>
        </NavLink>

        {hasChildren && (
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label={expanded ? `Collapse ${item.label}` : `Expand ${item.label}`}
            aria-expanded={expanded}
            className="ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {expanded ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {hasChildren && expanded && (
        <ul className="relative ml-[18px] mt-0.5 space-y-0.5 border-l border-border pl-3">
          {item.children.map((child) => (
            <li key={child.to}>
              <NavLink
                to={child.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'block truncate rounded-md px-2.5 py-1.5 text-sm transition-colors',
                    isActive && location.search === `?${child.to.split('?')[1] ?? ''}`
                      ? 'bg-accent font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                  )
                }
              >
                {child.label}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function Sidebar({ open, onClose }) {
  const { can, permissions } = useAuth()
  const [query, setQuery] = useState('')
  const [rail, setRail] = useState('overview')

  /* An entry is shown when the role holds its permission. A group lists
     several, and appears if any one of them is held. */
  const visible = (entry) => {
    if (entry?.perm) return can(entry.perm)
    if (entry?.perms) return entry.perms.some(can)
    return true
  }

  const groups = useMemo(() => {
    const term = query.trim().toLowerCase()

    return NAV
      .filter(visible)
      .map((group) => {
        const items = group.items
          .filter(visible)
          .map((item) => {
            if (!term) return item
            // Keep a group whose own label matches, with all its children;
            // otherwise keep only the children that match.
            if (item.label.toLowerCase().includes(term)) return item
            const children = item.children?.filter((c) =>
              c.label.toLowerCase().includes(term),
            )
            return children?.length ? { ...item, children } : null
          })
          .filter(Boolean)

        return items.length ? { ...group, items } : null
      })
      .filter(Boolean)
  }, [query, permissions]) // eslint-disable-line react-hooks/exhaustive-deps

  const railEntries = RAIL.filter(visible)

  const jumpTo = (id) => {
    setRail(id)
    document
      .getElementById(`nav-group-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex transition-transform duration-200',
          'lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Icon rail */}
        <div className="flex w-[60px] shrink-0 flex-col items-center gap-1 border-r border-border bg-muted/40 py-4">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <ScanFace className="h-5 w-5 text-primary-foreground" />
          </div>
          {railEntries.map((entry) => (
            <RailButton
              key={entry.id}
              entry={entry}
              active={rail === entry.id}
              onClick={() => jumpTo(entry.id)}
            />
          ))}
        </div>

        {/* Nav panel */}
        <div className="flex w-[232px] shrink-0 flex-col border-r border-border bg-background">
          <div className="flex h-16 items-center justify-between px-4">
            <span className="text-base font-semibold tracking-tight">Overview</span>
            <Button
              variant="ghost" size="icon"
              className="lg:hidden"
              onClick={onClose}
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="px-3 pb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-8 text-sm"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
            {groups.length ? (
              groups.map((group) => (
                <div key={group.id} id={`nav-group-${group.id}`}>
                  <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.section}
                  </p>
                  <ul className="space-y-0.5">
                    {group.items.map((item) => (
                      <NavItem
                        key={item.to}
                        item={item}
                        onNavigate={onClose}
                        forceOpen={Boolean(query.trim())}
                      />
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">
                Nothing matches “{query}”.
              </p>
            )}
          </nav>
        </div>
      </aside>
    </>
  )
}
