// path: app/api/email-broadcast-request/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { canCustomize } from '@/lib/customizeAccess'
import { getEmailBroadcastRequest, setEmailBroadcastRequest } from '@/lib/emailBroadcastRequest'

// "We'd like email broadcasts" — a flag a client admin can set, for the
// agency to action by configuring SMTP.
export async function GET(req: NextRequest) {
  const session = getSession(req)
  const clientId = req.nextUrl.searchParams.get('clientId') || session?.clientId || ''
  if (!canCustomize(session, clientId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ requested: await getEmailBroadcastRequest(clientId) })
}

export async function POST(req: NextRequest) {
  const session = getSession(req)
  const body = await req.json().catch(() => ({}))
  const clientId = body?.clientId || session?.clientId || ''
  if (!canCustomize(session, clientId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const ok = await setEmailBroadcastRequest(clientId, !!body?.requested)
  if (!ok) return NextResponse.json({ error: 'Could not save that request.' }, { status: 500 })
  return NextResponse.json({ requested: !!body?.requested })
}
