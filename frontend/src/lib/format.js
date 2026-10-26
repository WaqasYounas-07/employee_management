import { format, formatDistanceToNow, parseISO } from 'date-fns'

const asDate = (value) => (typeof value === 'string' ? parseISO(value) : value)

export function formatDate(value, pattern = 'd MMM yyyy') {
  if (!value) return '—'
  try {
    return format(asDate(value), pattern)
  } catch {
    return '—'
  }
}

export function formatTime(value) {
  if (!value) return '—'
  try {
    return format(asDate(value), 'HH:mm')
  } catch {
    return '—'
  }
}

export function formatDateTime(value) {
  if (!value) return '—'
  try {
    return format(asDate(value), 'd MMM, HH:mm')
  } catch {
    return '—'
  }
}

export function timeAgo(value) {
  if (!value) return 'never'
  try {
    return formatDistanceToNow(asDate(value), { addSuffix: true })
  } catch {
    return 'never'
  }
}

/** Hours as "8h 30m" — easier to scan in a table than "8.50". */
export function formatHours(value) {
  const hours = Number(value ?? 0)
  if (!hours) return '—'
  const whole = Math.floor(hours)
  const minutes = Math.round((hours - whole) * 60)
  return minutes ? `${whole}h ${minutes}m` : `${whole}h`
}

export function formatMinutes(value) {
  const minutes = Number(value ?? 0)
  if (!minutes) return '—'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/** YYYY-MM-DD in local time — the format every backend date filter expects. */
export function toISODate(date = new Date()) {
  const d = asDate(date)
  const month = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

export function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}
