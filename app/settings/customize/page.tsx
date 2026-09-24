// path: app/settings/customize/page.tsx
import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/serverAuth'
import { query } from '@/lib/db'
import { AGENCY_ROLES } from '@/lib/auth'
import CustomizeShell from '@/components/settings/CustomizeShell'

export default async function CustomizePage() {
  const session = getServerSession()
  if (!session) redirect('/login')

  const isAgency = AGENCY_ROLES.includes(session.role)
  // Counsellors now get this page too, but with only the day-to-day
  // sections on it (lib/settingsSections). Anyone with no sections at all
  // has no business here.
  if (!isAgency && session.role !== 'client_admin' && session.role !== 'client_counsellor') {
    redirect('/leads')
  }

  // A session can only ever query its own institute's database (see
  // lib/db.ts) — there's no query that reaches "every institute" from here,
  // agency role or not. So this always resolves to exactly the current
  // institute; switching to a different one is done from the institute
  // switcher in the sidebar (see /api/auth/switch-client), which actually
  // re-scopes the session, not by picking from a list fetched here.
  const institutes = session.clientId
    ? await query<{ id: string; name: string }>('SELECT id, name FROM clients WHERE id = $1', [session.clientId])
    : []

  return (
    <CustomizeShell
      institutes={institutes}
      lockedToClientId={session.clientId}
      showSettingsLink={isAgency}
      role={session.role}
    />
  )
}
