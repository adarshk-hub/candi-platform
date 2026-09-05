import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { markAllNotificationsRead, markLeadNotificationsRead } from '@/lib/notifications'

// POST { leadId } marks that lead's notifications read — fired when the
// lead is opened, which is what "checked" means here.
// POST { all: true } clears the whole bell.
export async function POST(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))

  try {
    if (body.all) {
      await markAllNotificationsRead(session)
    } else if (typeof body.leadId === 'string' && body.leadId) {
      await markLeadNotificationsRead(session, body.leadId)
    } else {
      return NextResponse.json({ error: 'leadId or all is required' }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[notifications] mark-read failed:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
