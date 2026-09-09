// path: app/team-day/page.tsx
import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/serverAuth'
import TeamDayBoard from '@/components/myday/TeamDayBoard'

// The management counterpart to /my-day. Admin-only, checked here as well as
// in the sidebar and the API.
export default function TeamDayPage() {
  const session = getServerSession()
  if (!session) redirect('/login')

  const allowed = ['agency_admin', 'agency_staff', 'client_admin'].includes(session.role)
  if (!allowed) redirect('/leads')

  return <TeamDayBoard />
}
