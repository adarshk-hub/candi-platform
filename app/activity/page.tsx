// path: app/activity/page.tsx
import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/serverAuth'
import ActivityDashboard from '@/components/activity/ActivityDashboard'

// Everything here is a live worklist that changes minute to minute as
// counsellors work through it, so unlike /leads there's nothing worth
// server-rendering ahead of time — the client fetches on mount and re-fetches
// after every action.
export default function ActivityPage() {
  const session = getServerSession()
  if (!session) redirect('/login')

  return <ActivityDashboard canAssign={session.role !== 'client_counsellor' && session.role !== 'client_staff'} />
}
