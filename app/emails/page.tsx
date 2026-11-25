// path: app/emails/page.tsx
import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/serverAuth'
import { isLocalOcto } from '@/lib/localOcto'
import SentEmails from '@/components/email/SentEmails'

// Local Octo only: every email that went out successfully.
export default function EmailsPage() {
  const session = getServerSession()
  if (!session) redirect('/login')
  if (!session.clientId || !isLocalOcto(session.clientId)) redirect('/leads')
  return <SentEmails clientId={session.clientId} />
}
