// path: lib/customizeAccess.ts
import { SessionUser, AGENCY_ROLES } from './auth'

// Who may edit an institute's customization settings (stages, sources,
// custom fields, counsellors, logo): agency staff for any client, or that
// institute's own staff for their own institute.
//
// Counsellors count as institute staff here. They used to be read-only,
// consuming the config without being able to change it; the schools asked
// for counsellors to work at the same level as their client admin, so the
// only line that still matters is which institute the login belongs to.
export function canCustomize(session: SessionUser | null, targetClientId: string): boolean {
  if (!session) return false
  if (AGENCY_ROLES.includes(session.role)) return true
  return (
    (session.role === 'client_admin' || session.role === 'client_counsellor') &&
    session.clientId === targetClientId
  )
}
