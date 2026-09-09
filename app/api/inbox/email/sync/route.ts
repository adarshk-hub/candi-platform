// path: app/api/inbox/email/sync/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { syncInbox } from '@/lib/emailInbox'

// Fired by the Refresh button in the Inbox. Runs on the Node runtime because
// imapflow opens a raw TLS socket, which the edge runtime has no equivalent
// for, and given a mailbox with a backlog it can take longer than the default
// serverless timeout allows.
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!session.clientId) {
    return NextResponse.json(
      { error: 'Switch to a specific institute before syncing its mailbox.' },
      { status: 400 }
    )
  }

  const result = await syncInbox(session.clientId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })
  return NextResponse.json(result)
}
