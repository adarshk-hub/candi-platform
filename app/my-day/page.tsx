// path: app/my-day/page.tsx
import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/serverAuth'
import MyDayBoard from '@/components/myday/MyDayBoard'

export default function MyDayPage() {
  const session = getServerSession()
  if (!session) redirect('/login')

  return <MyDayBoard />
}
