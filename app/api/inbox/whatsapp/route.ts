// path: app/api/inbox/whatsapp/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'

// Every WhatsApp message at the institute, in one place, visible to everyone
// — inbound and outbound, whoever the lead belongs to. Deliberately not
// scoped by assigned counsellor: this is the shared business number, and a
// parent messaging it at 8pm needs whoever is around to see it, not only the
// one person whose name happens to be on the lead.
//
// Read-only on purpose. Replying still goes through the lead itself, where
// the 24-hour window check, the tracked-link rewrite and the nurture pause
// all live — duplicating that here would mean two send paths to keep in step.
export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const leadId = sp.get('leadId')?.trim() || ''
  const search = sp.get('search')?.trim() || ''

  try {
    // One thread, when a conversation is open on screen.
    if (leadId) {
      const messages = await query(
        `SELECT wm.id, wm.direction, wm.message_type, wm.body, wm.status, wm.created_at,
                wm.template_name, u.full_name AS sent_by_name
         FROM whatsapp_messages wm
         LEFT JOIN users u ON u.id = wm.sent_by
         WHERE wm.lead_id = $1
         ORDER BY wm.created_at ASC
         LIMIT 200`,
        [leadId]
      )
      const [lead] = await query(
        `SELECT l.id, l.lead_number, l.full_name, l.whatsapp_number, l.pipeline_stage, l.client_id,
                u.full_name AS counsellor_name
         FROM leads l LEFT JOIN users u ON u.id = l.assigned_counsellor_id
         WHERE l.id = $1`,
        [leadId]
      )
      return NextResponse.json({ lead: lead || null, messages })
    }

    // Otherwise the conversation list. DISTINCT ON gives the newest message
    // per lead in a single pass — the alternative (group-by for the max
    // timestamp, then join back to fetch that row's body) reads the table
    // twice for the same answer.
    const params: any[] = []
    let having = ''
    if (search) {
      params.push(`%${search}%`)
      having = `WHERE l.full_name ILIKE $1 OR l.whatsapp_number ILIKE $1`
    }

    const conversations = await query(
      `SELECT * FROM (
         SELECT DISTINCT ON (wm.lead_id)
                wm.lead_id, wm.body, wm.direction, wm.created_at, wm.status,
                l.full_name, l.lead_number, l.whatsapp_number, l.pipeline_stage, l.client_id,
                u.full_name AS counsellor_name,
                (SELECT COUNT(*) FROM whatsapp_messages x
                  WHERE x.lead_id = wm.lead_id AND x.direction = 'inbound'
                    AND x.created_at > now() - INTERVAL '24 hours')::int AS recent_inbound
         FROM whatsapp_messages wm
         JOIN leads l ON l.id = wm.lead_id
         LEFT JOIN users u ON u.id = l.assigned_counsellor_id
         ${having}
         ORDER BY wm.lead_id, wm.created_at DESC
       ) t
       ORDER BY t.created_at DESC
       LIMIT 100`,
      params
    )

    return NextResponse.json({ conversations })
  } catch (err: any) {
    console.error('[inbox:whatsapp] failed:', err)
    return NextResponse.json({ error: 'Could not load conversations.' }, { status: 500 })
  }
}
