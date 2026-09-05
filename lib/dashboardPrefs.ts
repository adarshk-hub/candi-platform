// path: lib/dashboardPrefs.ts
import { query } from './db'

// The set of campaign ids this institute has unchecked on the dashboard.
// Anything not in here counts toward the totals, so a newly synced
// campaign is included until someone deliberately excludes it.
export async function getExcludedCampaignIds(clientId: string): Promise<string[]> {
  try {
    const rows = await query<{ campaign_id: string }>(
      'SELECT campaign_id FROM dashboard_excluded_campaigns WHERE client_id = $1',
      [clientId]
    )
    return rows.map((r) => r.campaign_id)
  } catch (err) {
    // The dashboard must still render if this migration hasn't run yet —
    // an empty set just means "everything counts", which is the old
    // behaviour.
    console.error('[dashboardPrefs] could not read exclusions:', err)
    return []
  }
}

// Replaces the whole exclusion set in one transaction-ish pass. The UI
// sends the full list on every toggle rather than a diff, so a dropped
// request can never leave the stored set half-applied — the next toggle
// resends the complete truth.
export async function setExcludedCampaignIds(clientId: string, campaignIds: string[]): Promise<void> {
  await query('DELETE FROM dashboard_excluded_campaigns WHERE client_id = $1', [clientId])

  if (campaignIds.length === 0) return

  // Guards against a stale browser tab posting ids that have since been
  // deleted, which would otherwise fail the campaigns foreign key and
  // reject the entire save.
  await query(
    `INSERT INTO dashboard_excluded_campaigns (client_id, campaign_id)
     SELECT $1, c.id FROM campaigns c
     WHERE c.id = ANY($2::uuid[])
     ON CONFLICT (client_id, campaign_id) DO NOTHING`,
    [clientId, campaignIds]
  )
}
