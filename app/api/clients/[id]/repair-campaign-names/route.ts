import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession, AGENCY_ROLES } from '@/lib/auth'
import { fetchMetaObjectName } from '@/lib/metaAdsSpend'

// Refreshes every Meta campaign's name directly from Meta — no guessing at
// which rows "look like" a placeholder by matching stored text (that's
// exactly what broke before: reconstructing or pattern-matching the old
// "Auto: ..." string is fragile and can silently miss real rows). Since
// the account is already connected to Meta, this just re-asks Meta for
// the real name of every campaign this client has, every time it's run,
// and overwrites whatever's currently stored.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!session || !AGENCY_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const campaigns = await query<{ id: string; platform_campaign_id: string; display_name: string }>(
    `SELECT id, platform_campaign_id, display_name FROM campaigns
     WHERE client_id = $1 AND platform = 'meta'`,
    [params.id]
  )

  let updated = 0
  const unresolved: string[] = []
  for (const c of campaigns) {
    const realName = await fetchMetaObjectName(c.platform_campaign_id)
    if (realName && realName !== c.display_name) {
      await query('UPDATE campaigns SET display_name = $1 WHERE id = $2', [realName, c.id])
      updated++
    } else if (!realName) {
      unresolved.push(c.platform_campaign_id)
    }
  }

  return NextResponse.json({ checked: campaigns.length, updated, unresolved })
}
