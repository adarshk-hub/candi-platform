// path: app/sms/page.tsx
import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/serverAuth'
import { isLocalOcto } from '@/lib/localOcto'
import SmsShell from '@/components/sms/SmsShell'

// Local Octo only: SMS Inbox (sent SMS) and SMS Broadcast.
export default function SmsPage() {
  const session = getServerSession()
  if (!session) redirect('/login')
  if (!session.clientId || !isLocalOcto(session.clientId)) redirect('/leads')

  return <SmsShell clientId={session.clientId} canBroadcast={session.role !== 'client_counsellor'} />
}
