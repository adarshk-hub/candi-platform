// path: lib/moduleAccess.ts
import { Role } from './auth'

export interface ModulePage {
  key: string
  label: string
  href: string
}

// Every sidebar destination a counsellor's login can be granted or denied.
// Settings is deliberately absent — it is gated by role (see
// lib/customizeAccess.ts) and is never something a counsellor can be given.
export const MODULE_PAGES: ModulePage[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard' },
  { key: 'inbox', label: 'Inbox', href: '/inbox' },
  { key: 'follow_ups', label: 'Next Actions', href: '/follow-ups' },
  { key: 'calendar', label: 'Calendar View', href: '/calendar' },
  { key: 'leads', label: 'All Leads', href: '/leads' },
  { key: 'broadcasts', label: 'Broadcasts', href: '/broadcasts' },
  { key: 'performance', label: 'Counsellor Performance', href: '/performance' },
]

// What a counsellor gets when nobody has picked pages for them yet. Chosen
// to match what counsellors could already reach before this feature existed,
// so turning the migration on changes nothing until someone edits a login.
export const DEFAULT_COUNSELLOR_PAGES = ['inbox', 'follow_ups', 'calendar', 'leads']

// Reporting on counsellors is management information, so it stays with
// management no matter what boxes get ticked on a counsellor's login.
// Dashboard is deliberately not in here: it's ordinary role-gated content
// that an institute can choose to open up to a counsellor.
const ADMIN_ONLY_PAGES = ['performance']

// The mirror image: pages that only make sense for the people doing the
// day-to-day work. My Day is a personal worklog — an admin has no leads of
// their own to log against it, so for them it would only ever be an empty
// screen. Managers who want to see how a counsellor's day went have the
// Performance report instead.
// Nothing is counsellor-only any more: My Day folded into Next Actions
// (their own leads, scoped server-side) and Team Day into Performance.
const COUNSELLOR_ONLY_PAGES: string[] = []

const ADMIN_ROLES: Role[] = ['agency_admin', 'agency_staff', 'client_admin']

export function canAccessPage(role: Role, allowedPages: string[] | null, pageKey: string): boolean {
  if (ADMIN_ONLY_PAGES.includes(pageKey)) return ADMIN_ROLES.includes(role)
  if (COUNSELLOR_ONLY_PAGES.includes(pageKey) && role !== 'client_counsellor') return false
  if (role !== 'client_counsellor') return true
  const allowed = allowedPages && allowedPages.length > 0 ? allowedPages : DEFAULT_COUNSELLOR_PAGES
  return allowed.includes(pageKey)
}

// Maps a URL back to the page it belongs to. Prefix matching, because
// /leads?tab=hot and /dashboard/<clientId> are the same module as their
// parent route.
export function pageKeyForPath(pathname: string): string | null {
  if (pathname.startsWith('/dashboard')) return 'dashboard'
  if (pathname.startsWith('/inbox')) return 'inbox'
  if (pathname.startsWith('/follow-ups')) return 'follow_ups'
  if (pathname.startsWith('/calendar')) return 'calendar'
  if (pathname.startsWith('/leads')) return 'leads'
  if (pathname.startsWith('/broadcasts')) return 'broadcasts'
  if (pathname.startsWith('/performance')) return 'performance'
  return null
}

// The page a blocked user is sent to instead. Their first permitted page,
// so someone who only has Follow Up lands there rather than on a dead end.
export function firstAllowedHref(role: Role, allowedPages: string[] | null): string {
  const page = MODULE_PAGES.find((p) => canAccessPage(role, allowedPages, p.key))
  return page?.href || '/leads'
}
