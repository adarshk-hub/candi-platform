// path: lib/settingsSections.ts
// No imports on purpose. This file is read by CustomizeShell, a client
// component, so pulling in lib/auth would drag jsonwebtoken into the
// browser bundle — which is exactly what broke every page with a
// client-side exception, not just Settings.
const AGENCY: string[] = ['agency_admin', 'agency_staff']

// The shape this needs from a session, without importing the session type.
interface SessionLike {
  role: string
  clientId: string | null
}

// Which Customize sections each role may open. One list, read by the screen
// that draws the tabs and by the APIs behind them, so a section a role
// cannot see is also a section it cannot write to by calling the endpoint
// directly.
//
//   Agency      — everything.
//   Client admin— everything except the three integration screens, which
//                 hold credentials the agency manages: School Email,
//                 WhatsApp API and Conversions API.
//   Counsellor  — the day-to-day lists only, and nothing that touches
//                 logins, money or credentials.
export type SettingsSection =
  | 'stages'
  | 'lead_source'
  | 'cold_reason'
  | 'fields'
  | 'counsellors'
  | 'assignment'
  | 'email'
  | 'whatsapp'
  | 'capi'
  | 'lead_range'
  | 'display'
  | 'activity'

// The integration screens a client admin never sees. WhatsApp is not among
// them any more: a client admin opens that section, but only to top up the
// wallet — the credentials and the test send stay agency-only, enforced
// inside the panel and by canEditWhatsAppConfig below.
const AGENCY_ONLY_SECTIONS: SettingsSection[] = ['email', 'capi']

// Who may see and change the Meta credentials (phone number id, WABA id,
// access token) and send the test message.
export function canEditWhatsAppConfig(role: string | null | undefined): boolean {
  return !!role && AGENCY.includes(role)
}

export const COUNSELLOR_SECTIONS: SettingsSection[] = [
  'stages',
  'lead_source',
  'fields',
  'lead_range',
  'display',
  'activity',
]

export function sectionsForRole(role: string | null | undefined): SettingsSection[] {
  const all: SettingsSection[] = [
    'stages',
    'lead_source',
    'cold_reason',
    'fields',
    'counsellors',
    'assignment',
    'email',
    'whatsapp',
    'capi',
    'lead_range',
    'display',
    'activity',
  ]
  if (!role) return []
  if (AGENCY.includes(role)) return all
  if (role === 'client_admin') return all.filter((s) => !AGENCY_ONLY_SECTIONS.includes(s))
  if (role === 'client_counsellor') return COUNSELLOR_SECTIONS
  return []
}

export function canOpenSection(role: string | null | undefined, section: SettingsSection): boolean {
  return sectionsForRole(role).includes(section)
}

// Server-side permission for one settings section. Replaces a plain
// canCustomize check in the endpoints behind the sections a counsellor may
// now open — the institute still has to match, so a counsellor can only
// ever edit their own school's lists.
export function canEditSection(
  session: SessionLike | null,
  targetClientId: string | null | undefined,
  section: SettingsSection
): boolean {
  if (!session || !targetClientId) return false
  if (!canOpenSection(session.role, section)) return false
  if (AGENCY.includes(session.role)) return true
  return session.clientId === targetClientId
}
