// path: app/templates/page.tsx
import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/serverAuth'
import { query } from '@/lib/db'
import { AGENCY_ROLES } from '@/lib/auth'
import TemplatesShell from '@/components/templates/TemplatesShell'

export const dynamic = 'force-dynamic'

export default async function TemplatesPage() {
  const session = getServerSession()
  if (!session) redirect('/login')

  // Writing messages and changing the schedule costs money out of the
  // client's wallet when they send, so counsellors don't get this page —
  // same restriction as Broadcast and Settings > Customize.
  if (session.role === 'client_counsellor') redirect('/leads')

  const isAgency = AGENCY_ROLES.includes(session.role)
  const institutes = isAgency
    ? await query<{ id: string; name: string }>('SELECT id, name FROM clients ORDER BY name')
    : session.clientId
      ? await query<{ id: string; name: string }>('SELECT id, name FROM clients WHERE id = $1', [session.clientId])
      : []

  return <TemplatesShell institutes={institutes} lockedToClientId={isAgency ? null : session.clientId} />
}
