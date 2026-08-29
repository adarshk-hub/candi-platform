import { NextRequest, NextResponse } from 'next/server'
import { centralQuery } from '@/lib/db'
import { getSession, AGENCY_ROLES } from '@/lib/auth'
import { backfillMetaLeadsForClient, META_LEAD_RETENTION_DAYS } from '@/lib/metaLeadAdsBackfill'

// One-time (or occasionally re-run) catch-up for leads that came in through
// Meta Lead Ads forms before this CRM was capturing them live via webhook.
// Deliberately does NOT fire Conversions API events for anything pulled in
// here — those leads are old news by definition, and reporting them to Meta
// as if they just converted would misrepresent real-time performance to
// Meta's ad delivery algorithm.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!session || !AGENCY_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Registry data, not this client's own CRM data — see lib/db.ts.
  const client = (await centralQuery<{ id: string; meta_page_id: string | null }>(
    'SELECT id, meta_page_id FROM clients WHERE id = $1',
    [params.id]
  ))[0]
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  if (!client.meta_page_id) {
    return NextResponse.json({ error: 'This client has no Meta Page ID configured (clients.meta_page_id).' }, { status: 400 })
  }

  const result = await backfillMetaLeadsForClient(client.id, client.meta_page_id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error || 'Failed to fetch historical leads from Meta' }, { status: 502 })
  }

  return NextResponse.json({
    ok: true,
    totalFound: result.totalFound,
    created: result.created,
    duplicate: result.duplicate,
    retentionNote: `Meta only retains Lead Ads submissions for ${META_LEAD_RETENTION_DAYS} days — anything older was already gone before this ran.`,
  })
}
