// path: app/audience/page.tsx
import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/serverAuth'
import AudienceBoard from '@/components/audience/AudienceBoard'

// Broadcasting is admin work (counsellors can't build one — see
// app/api/broadcasts/preview/route.ts), so the audiences behind it are too.
export default function AudiencePage() {
  const session = getServerSession()
  if (!session) redirect('/login')

  const allowed = ['agency_admin', 'agency_staff', 'client_admin'].includes(session.role)
  if (!allowed) redirect('/leads')

  return <AudienceBoard clientId={session.clientId || ''} />
}
