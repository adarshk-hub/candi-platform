// path: app/templates/automation/page.tsx
import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/serverAuth'
import { query } from '@/lib/db'
import { AGENCY_ROLES } from '@/lib/auth'
import { canAccessPage } from '@/lib/moduleAccess'
import AutomationShell from '@/components/templates/AutomationShell'

export const dynamic = 'force-dynamic'

export default async function AutomationPage() {
  const session = getServerSession()
  if (!session) redirect('/login')

  // Counsellors reach this page only when their login has been given it in
  // Settings > Counsellors ("WhatsApp Templates"), the same rule the
  // sidebar uses.
  if (session.role === 'client_counsellor') {
    const [row] = await query<{ allowed_pages: string[] | null }>(
      'SELECT allowed_pages FROM users WHERE id = $1',
      [session.id]
    )
    if (!canAccessPage(session.role, row?.allowed_pages || null, 'templates')) redirect('/leads')
  }

  const isAgency = AGENCY_ROLES.includes(session.role)
  const institutes = isAgency
    ? await query<{ id: string; name: string }>('SELECT id, name FROM clients ORDER BY name')
    : session.clientId
      ? await query<{ id: string; name: string }>('SELECT id, name FROM clients WHERE id = $1', [session.clientId])
      : []

  return <AutomationShell institutes={institutes} lockedToClientId={isAgency ? null : session.clientId} />
}
