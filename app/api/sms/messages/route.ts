// path: app/api/sms/messages/route.ts
// Local Octo only: successfully sent SMS, newest first, for the SMS Inbox.
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession, AGENCY_ROLES } from '@/lib/auth'
import { isLocalOcto } from '@/lib/localOcto'

export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const clientId = AGENCY_ROLES.includes(session.role) ? sp.get('clientId') || session.clientId : session.clientId
  if (!clientId || !isLocalOcto(clientId)) return NextResponse.json({ enabled: false, messages: [] })

  const q = (sp.get('q') || '').trim()
  const params: any[] = [clientId]
  let where = 'l.client_id = $1'
  if (q) {
    params.push(`%${q}%`)
    where += ` AND (l.full_name ILIKE $2 OR l.child_name ILIKE $2 OR s.mobile ILIKE $2 OR s.template_name ILIKE $2)`
  }

  try {
    const messages = await query(
      `SELECT s.id, s.lead_id, s.template_name, s.body, s.mobile, s.trigger, s.broadcast_name, s.created_at,
              l.full_name, l.child_name, l.lead_number, u.full_name AS sent_by_name
       FROM sms_messages s
       JOIN leads l ON l.id = s.lead_id
       LEFT JOIN users u ON u.id = s.sent_by
       WHERE ${where}
       ORDER BY s.created_at DESC
       LIMIT 500`,
      params
    )
    return NextResponse.json({ enabled: true, messages })
  } catch {
    return NextResponse.json({ enabled: true, messages: [], error: 'SMS table not set up yet.' })
  }
}
