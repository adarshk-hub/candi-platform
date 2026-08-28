import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession, AGENCY_ROLES } from '@/lib/auth'
import { fetchMetaObjectName } from '@/lib/metaAdsSpend'

// One-off repair for campaigns created before the real-name resolution fix
// existed — findOrCreateCampaign only tries to fix a stuck "Auto: ..." name
// the next time a lead happens to land on that campaign, which could be a
// long wait for older, low-volume campaigns. This runs the same resolution
// against every campaign that's still on the placeholder, right now.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!session || !AGENCY_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const stuck = await query<{ id: string; platform_campaign_id: string }>(
    `SELECT id, platform_campaign_id FROM campaigns
     WHERE client_id = $1 AND platform = 'meta' AND display_name = 'Auto: ' || platform_campaign_id`,
    [params.id]
  )

  let fixed = 0
  const stillUnresolved: string[] = []
  for (const c of stuck) {
    const realName = await fetchMetaObjectName(c.platform_campaign_id)
    if (realName) {
      await query('UPDATE campaigns SET display_name = $1 WHERE id = $2', [realName, c.id])
      fixed++
    } else {
      stillUnresolved.push(c.platform_campaign_id)
    }
  }

  return NextResponse.json({ checked: stuck.length, fixed, stillUnresolved })
}
