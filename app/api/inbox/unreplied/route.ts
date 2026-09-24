// path: app/api/inbox/unreplied/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'

// How many parent messages are still waiting on a reply — NOT how many are
// unseen. Reading a message in the inbox does not make it answered, so the
// badge only clears once somebody actually sends something back. A message
// counts as unreplied when it arrived after the last outbound message on
// that thread.
export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const rows = await query<{ lead_id: string; unreplied: number }>(
      `SELECT wm.lead_id, COUNT(*)::int AS unreplied
       FROM whatsapp_messages wm
       WHERE wm.direction = 'inbound'
         AND wm.created_at > COALESCE(
           (SELECT MAX(o.created_at) FROM whatsapp_messages o
             WHERE o.lead_id = wm.lead_id AND o.direction = 'outbound'),
           '-infinity'::timestamp
         )
       GROUP BY wm.lead_id`
    )

    const byLead: Record<string, number> = {}
    let total = 0
    for (const row of rows) {
      byLead[row.lead_id] = row.unreplied
      total += row.unreplied
    }
    return NextResponse.json({ total, threads: rows.length, byLead })
  } catch (err) {
    console.error('[inbox:unreplied] failed:', err)
    return NextResponse.json({ total: 0, threads: 0, byLead: {} })
  }
}
