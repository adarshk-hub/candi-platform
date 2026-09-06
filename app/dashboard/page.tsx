// path: app/dashboard/page.tsx
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
    // cross-client summary.
    //
    // Which institute: the one this session is already in. Login resolves it
    // from the institute name typed on the sign-in form, and the sidebar's
    // InstituteSwitcher rewrites it on the cookie. Re-deriving it here with
    // "first by name" ignored both — an agency user who signed into Candid,
    // or switched to it, still got bounced to whichever institute sorted
    // first. The alphabetical lookup below is now only a fallback for a
    // session that somehow carries no institute at all.
    const target =
      session.clientId ||
      (await query<{ id: string }>('SELECT id FROM clients ORDER BY name LIMIT 1'))[0]?.id
    if (target) {
      const qs = new URLSearchParams()
      if (searchParams.from) qs.set('from', searchParams.from)
      if (searchParams.to) qs.set('to', searchParams.to)
      const suffix = qs.toString() ? `?${qs.toString()}` : ''
      redirect(`/dashboard/${target}${suffix}`)
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
  return <ClientDashboard clientId={client.id} clientName={client.name} from={searchParams.from} to={searchParams.to} basePath="/dashboard" />
}
