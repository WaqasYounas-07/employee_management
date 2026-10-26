import { Badge } from '@/components/ui/badge'
import {
  ATTENDANCE_STATUS, EMPLOYEE_STATUS, LEAVE_STATUS, RECOGNITION_DECISION,
} from '@/lib/constants'

const MAPS = {
  attendance: ATTENDANCE_STATUS,
  employee: EMPLOYEE_STATUS,
  leave: LEAVE_STATUS,
  recognition: RECOGNITION_DECISION,
}

/** Renders a backend status value with its agreed label and tone. */
export function StatusBadge({ kind, value, className }) {
  const entry = MAPS[kind]?.[value]
  if (!entry) return <Badge tone="muted" className={className}>{value ?? '—'}</Badge>
  return <Badge tone={entry.tone} className={className}>{entry.label}</Badge>
}
