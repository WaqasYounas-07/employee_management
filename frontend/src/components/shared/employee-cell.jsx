import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initials } from '@/lib/format'

/** Avatar + name + code, the way an employee appears throughout the app. */
export function EmployeeCell({ name, code, photo, size = 'default' }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar className={size === 'sm' ? 'h-7 w-7' : 'h-9 w-9'}>
        {photo && <AvatarImage src={photo} alt="" />}
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate font-medium leading-tight">{name}</p>
        {code && <p className="truncate text-xs text-muted-foreground">{code}</p>}
      </div>
    </div>
  )
}
