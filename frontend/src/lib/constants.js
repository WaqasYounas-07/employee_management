/* Mirrors the backend's TextChoices. Keeping the labels here means a status
   renders the same way in every table, badge and filter. */

export const ROLES = {
  admin: 'Admin',
  hr: 'HR',
  manager: 'Manager',
  employee: 'Employee',
}

export const EMPLOYEE_STATUS = {
  active: { label: 'Active', tone: 'success' },
  probation: { label: 'Probation', tone: 'warning' },
  suspended: { label: 'Suspended', tone: 'destructive' },
  terminated: { label: 'Terminated', tone: 'muted' },
}

export const EMPLOYMENT_TYPE = {
  full_time: 'Full time',
  part_time: 'Part time',
  contract: 'Contract',
  intern: 'Intern',
}

export const ATTENDANCE_STATUS = {
  present: { label: 'Present', tone: 'success' },
  late: { label: 'Late', tone: 'warning' },
  half_day: { label: 'Half day', tone: 'info' },
  absent: { label: 'Absent', tone: 'destructive' },
  on_leave: { label: 'On leave', tone: 'info' },
  holiday: { label: 'Holiday', tone: 'muted' },
}

export const LEAVE_STATUS = {
  pending: { label: 'Pending', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'destructive' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
}

/* Every outcome the ingest endpoint can return for a frame. */
export const RECOGNITION_DECISION = {
  matched: { label: 'Matched', tone: 'success' },
  no_match: { label: 'No match', tone: 'destructive' },
  low_confidence: { label: 'Low confidence', tone: 'warning' },
  no_face: { label: 'No face', tone: 'muted' },
  duplicate: { label: 'Duplicate', tone: 'info' },
  error: { label: 'Error', tone: 'destructive' },
}

export const CAMERA_DIRECTION = {
  in: 'Entry only',
  out: 'Exit only',
  both: 'Entry and exit',
}

/** Roles allowed to manage other people's records. */
export const STAFF_ROLES = ['admin', 'hr', 'manager']
export const HR_ROLES = ['admin', 'hr']
