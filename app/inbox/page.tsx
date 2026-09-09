// path: app/inbox/page.tsx
import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/serverAuth'
import InboxShell from '@/components/inbox/InboxShell'

export default function InboxPage() {
  const session = getServerSession()
  if (!session) redirect('/login')

  return <InboxShell />
}
