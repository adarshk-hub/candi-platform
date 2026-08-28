import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/serverAuth'
import { query } from '@/lib/db'
import AgencyDashboard from '@/components/dashboard/AgencyDashboard'
import ClientDashboard from '@/components/dashboard/ClientDashboard'

export const dynamic = 'force-dynamic'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string }
}) {
  const session = getServerSession()
  if (!session) redirect('/login')

  if (session.role === 'client_counsellor') {
    redirect('/leads')
  }

  if (session.role === 'agency_admin' || session.role === 'agency_staff') {
    // The full agency-wide overview (AgencyDashboard) is being deferred for
    // now — clicking "Dashboard" should land straight on the same rich
    // per-institute pipeline view a client_admin sees, not the old
    // cross-client summary. Redirects to the same institute ordering
    // AgencyDashboard's own "Institutes" list uses (by name), so this is
    // just "start on the first one" rather than a different order.
    const first = (await query<{ id: string }>('SELECT id FROM clients ORDER BY name LIMIT 1'))[0]
    if (first) {
      const qs = new URLSearchParams()
      if (searchParams.from) qs.set('from', searchParams.from)
      if (searchParams.to) qs.set('to', searchParams.to)
      const suffix = qs.toString() ? `?${qs.toString()}` : ''
      redirect(`/dashboard/${first.id}${suffix}`)
    }
    return <AgencyDashboard from={searchParams.from} to={searchParams.to} />
  }

  // client_admin — scoped strictly to their own workspace, never a list of
  // other institutions.
  if (!session.clientId) {
    return <p className="text-muted2">No institution linked to this account.</p>
  }
  const client = (await query<{ id: string; name: string }>('SELECT id, name FROM clients WHERE id = $1', [session.clientId]))[0]
  if (!client) {
    return <p className="text-muted2">Institution not found.</p>
  }
  return <ClientDashboard clientId={client.id} clientName={client.name} from={searchParams.from} to={searchParams.to} />
}
