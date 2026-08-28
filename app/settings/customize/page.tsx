import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/serverAuth'
import { query } from '@/lib/db'
import { AGENCY_ROLES } from '@/lib/auth'
import CustomizeShell from '@/components/settings/CustomizeShell'
import InstituteSwitcher from '@/components/settings/InstituteSwitcher'

export default async function CustomizePage() {
  const session = getServerSession()
  if (!session) redirect('/login')

  const isAgency = AGENCY_ROLES.includes(session.role)
  if (!isAgency && session.role !== 'client_admin') redirect('/settings')

  // A session can only ever query its own institute's database (see
  // lib/db.ts) — there's no query that reaches "every institute" from here,
  // agency role or not. So this always resolves to exactly the current
  // institute; switching to a different one is handled by InstituteSwitcher
  // actually re-scoping the session (see /api/auth/switch-client), not by
  // picking from a list fetched here.
  const institutes = session.clientId
    ? await query<{ id: string; name: string }>('SELECT id, name FROM clients WHERE id = $1', [session.clientId])
    : []

  return (
    <div>
      {isAgency && (
        <div className="mb-4 flex justify-end">
          <InstituteSwitcher currentClientId={session.clientId} currentClientName={institutes[0]?.name || ''} />
        </div>
      )}
      <CustomizeShell institutes={institutes} lockedToClientId={session.clientId} />
    </div>
  )
}
