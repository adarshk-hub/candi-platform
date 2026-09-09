// path: app/performance/page.tsx
import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/serverAuth'
import CounsellorPerformance from '@/components/reports/CounsellorPerformance'

// Admin-only, checked here as well as in the API. Redirecting rather than
// showing a "forbidden" screen: a counsellor who somehow lands on this URL
// should just end up somewhere useful.
export default function PerformancePage() {
  const session = getServerSession()
  if (!session) redirect('/login')

  const allowed = ['agency_admin', 'agency_staff', 'client_admin'].includes(session.role)
  if (!allowed) redirect('/leads')

  return <CounsellorPerformance />
}
