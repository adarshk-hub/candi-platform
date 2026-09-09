// path: app/my-day/page.tsx
import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/serverAuth'
import MyDayBoard from '@/components/myday/MyDayBoard'

export default function MyDayPage() {
  const session = getServerSession()
  if (!session) redirect('/login')

  // Counsellors only. This is a personal worklog built from the leads
  // somebody actually works — for an admin it would render as an empty
  // timeline, which reads as a bug rather than as "not for you". Checked
  // here as well as in the sidebar so the URL can't be typed into.
  if (session.role !== 'client_counsellor') redirect('/leads')

  return <MyDayBoard />
}
