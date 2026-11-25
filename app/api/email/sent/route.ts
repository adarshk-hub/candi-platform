// path: app/api/email/sent/route.ts
// Local Octo only: emails that went out successfully, newest first, for the
// Sent Emails page. Failed ones show only in each lead's Email tab/Activity.
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
  const args: any[] = [clientId]
  let where = `l.client_id = $1 AND em.status = 'sent'`
  if (q) {
    args.push(`%${q}%`)
    where += ` AND (l.full_name ILIKE $2 OR l.child_name ILIKE $2 OR em.to_email ILIKE $2 OR em.subject ILIKE $2)`
  }
  try {
    const messages = await query(
      `SELECT em.id, em.lead_id, em.template_key, em.subject, em.body, em.to_email, em.created_at,
              l.full_name, l.child_name, u.full_name AS sent_by_name
       FROM email_messages em
       JOIN leads l ON l.id = em.lead_id
       LEFT JOIN users u ON u.id = em.sent_by
       WHERE ${where}
       ORDER BY em.created_at DESC
       LIMIT 500`,
      args
    )
    return NextResponse.json({ enabled: true, messages })
  } catch {
    return NextResponse.json({ enabled: true, messages: [], error: 'Could not load sent emails.' })
  }
}
