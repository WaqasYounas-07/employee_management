import { LogOut, Menu, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/features/auth/auth-context'
import { ROLES } from '@/lib/constants'
import { initials } from '@/lib/format'
import { ThemeToggle } from './theme-toggle'

export function Topbar({ onMenuClick }) {
  const { user, logout } = useAuth()
  const name =
    [user?.first_name, user?.last_name].filter(Boolean).join(' ') ||
    user?.username ||
    user?.email

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-6">
      <Button
        variant="ghost" size="icon"
        className="lg:hidden"
        onClick={onMenuClick}
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="flex-1" />

      <ThemeToggle />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2.5 rounded-full p-0.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar>
              {user?.employee?.photo && <AvatarImage src={user.employee.photo} alt="" />}
              <AvatarFallback>{initials(name)}</AvatarFallback>
            </Avatar>
            <span className="hidden pr-2 text-sm font-medium sm:block">{name}</span>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="font-normal">
            <div className="space-y-1">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
              <Badge tone="outline" className="mt-1.5">{ROLES[user?.role] ?? user?.role}</Badge>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {user?.employee && (
            <DropdownMenuItem disabled className="opacity-100">
              <UserRound />
              <span className="truncate">{user.employee.employee_code}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
