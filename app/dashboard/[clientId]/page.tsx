import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/serverAuth'
import { query } from '@/lib/db'
import { AGENCY_ROLES } from '@/lib/auth'
import ClientDashboard from '@/components/dashboard/ClientDashboard'

export const dynamic = 'force-dynamic'

// Fills the gap AgencyDashboard always had: an agency_admin/agency_staff
// session has no clientId of its own, so app/dashboard/page.tsx could never
// route them to a specific institute's funnel/cost-metrics/campaign view —
// only the aggregate cross-client overview. This route is that missing
// per-institute view, reached from the "Institutes" list on the agency
// dashboard.
export default async function ClientDashboardPage({
  params,
  searchParams,
}: {
  params: { clientId: string }
  searchParams: { from?: string; to?: string }
}) {
  const session = getServerSession()
  if (!session) redirect('/login')

  if (!AGENCY_ROLES.includes(session.role)) {
    redirect('/dashboard')
  }

  // Switching institutes swaps the session onto the target institute's own
  // database and reloads the current URL — which, on this route, still
  // carries the *previous* institute's id. That id doesn't exist in the
  // institute now being queried, so the lookup below came back empty and
  // rendered "Institution not found." until the person navigated away and
  // back. Realign the URL with the session instead.
  if (session.clientId && params.clientId !== session.clientId) {
    const qs = new URLSearchParams()
    if (searchParams.from) qs.set('from', searchParams.from)
    if (searchParams.to) qs.set('to', searchParams.to)
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    redirect(`/dashboard/${session.clientId}${suffix}`)
  }

  const client = (await query<{ id: string; name: string }>('SELECT id, name FROM clients WHERE id = $1', [params.clientId]))[0]
  if (!client) {
    return <p className="text-muted2">Institution not found.</p>
  }

  return (
    <ClientDashboard
      clientId={client.id}
      clientName={client.name}
      from={searchParams.from}
      to={searchParams.to}
      basePath={`/dashboard/${client.id}`}
    />
  )
}
