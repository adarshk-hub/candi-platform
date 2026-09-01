const META_API_VERSION = process.env.META_MARKETING_API_VERSION || 'v19.0'

export interface CampaignSpend {
  platformCampaignId: string
  campaignName: string
  spend: number
}

// Looks up a single campaign or ad set's real name directly from Meta —
// used when a lead first creates a brand-new campaigns row (see
// findOrCreateCampaign in leadIntake.ts), so what gets stored is the
// institute's actual campaign name ("JEE 2025 Batch") instead of the
// "Auto: {raw campaign id}" placeholder that was showing before. Only
// called once per new campaign/ad set — findOrCreateCampaign dedupes by
// platform_campaign_id, so existing campaigns never re-hit this.
export async function fetchMetaObjectName(objectId: string): Promise<string | null> {
  const token = process.env.META_MARKETING_API_ACCESS_TOKEN
  if (!token) {
    // TEMP DIAGNOSTIC — remove once campaign naming is confirmed working.
    console.log(`[campaign-name] META_MARKETING_API_ACCESS_TOKEN is not set — falling back to "Auto: ${objectId}"`)
    return null
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${objectId}?fields=name&access_token=${token}`)
    if (!res.ok) {
      // TEMP DIAGNOSTIC — remove once campaign naming is confirmed working.
      console.log(`[campaign-name] Meta returned ${res.status} for ${objectId}: ${await res.text()}`)
      return null
    }
    const data = await res.json()
    if (!data?.name) {
      // TEMP DIAGNOSTIC — remove once campaign naming is confirmed working.
      console.log(`[campaign-name] Meta returned no name field for ${objectId}: ${JSON.stringify(data)}`)
    }
    return data?.name || null
  } catch (err: any) {
    // TEMP DIAGNOSTIC — remove once campaign naming is confirmed working.
    console.log(`[campaign-name] fetch threw for ${objectId}: ${err?.message}`)
    return null
  }
}

// Pulls per-campaign spend for one ad account over a date range from Meta's
// Marketing API (Insights endpoint, campaign-level breakdown). Requires a
// System User access token with ads_read permission on the ad account —
// confirm the exact token/permission setup in Meta Business Settings once
// ready. Until META_MARKETING_API_ACCESS_TOKEN is set, returns stub data so
// the sync pipeline (matching, upserting, UI) is fully exercisable in dev.
export async function fetchMetaCampaignSpend(params: {
  adAccountId: string
  since: string // YYYY-MM-DD
  until: string // YYYY-MM-DD
}): Promise<CampaignSpend[]> {
  const token = process.env.META_MARKETING_API_ACCESS_TOKEN

  if (!token) {
    console.log(
      `[meta-ads:stub] would fetch campaign spend for act_${params.adAccountId} from ${params.since} to ${params.until}`
    )
    return []
  }

  const url = new URL(`https://graph.facebook.com/${META_API_VERSION}/act_${params.adAccountId}/insights`)
  url.searchParams.set('level', 'campaign')
  url.searchParams.set('fields', 'campaign_id,campaign_name,spend')
  url.searchParams.set('time_range', JSON.stringify({ since: params.since, until: params.until }))
  url.searchParams.set('access_token', token)

  const res = await fetch(url.toString())
  if (!res.ok) {
    throw new Error(`Meta Insights API returned ${res.status}: ${await res.text()}`)
  }
  const data = await res.json()

  return (data.data || []).map((row: any) => ({
    platformCampaignId: row.campaign_id,
    campaignName: row.campaign_name,
    spend: parseFloat(row.spend) || 0,
  }))
}

export interface WeeklyCampaignSpend extends CampaignSpend {
  // Despite the field name (kept as-is to avoid a wider rename), this is a
  // single DAY, not a week — see the time_increment note below.
  weekStarting: string // YYYY-MM-DD
}

// Same Insights endpoint as fetchMetaCampaignSpend, but spans a wider date
// range and asks Meta to bucket results by day (time_increment=1) rather
// than us looping one API call per day — one request returns however many
// days of history exist in the range. Used for backfilling historical
// spend, and now also by the regular sync (see adSpendSync.ts) so every
// stored row is always day-granular — never a mix of daily and weekly
// buckets, which would double-count whenever both cover the same date.
//
// This used to request time_increment=7 (weekly buckets), which is why
// date-range filtering on the dashboard could only ever be as precise as
// "which week," not "which day" — a Custom range of Aug 2-31 could include
// or exclude a few extra days at either edge depending on where the stored
// week happened to start. Daily buckets make the stored data exactly as
// precise as what a person can select in the date picker.
export async function fetchMetaCampaignSpendRange(params: {
  adAccountId: string
  since: string // YYYY-MM-DD
  until: string // YYYY-MM-DD
}): Promise<WeeklyCampaignSpend[]> {
  const token = process.env.META_MARKETING_API_ACCESS_TOKEN
  if (!token) {
    console.log(`[meta-ads:stub] would backfill campaign spend for act_${params.adAccountId} from ${params.since} to ${params.until}`)
    return []
  }

  const results: WeeklyCampaignSpend[] = []
  let url: string | null = (() => {
    const u = new URL(`https://graph.facebook.com/${META_API_VERSION}/act_${params.adAccountId}/insights`)
    u.searchParams.set('level', 'campaign')
    u.searchParams.set('fields', 'campaign_id,campaign_name,spend')
    u.searchParams.set('time_range', JSON.stringify({ since: params.since, until: params.until }))
    u.searchParams.set('time_increment', '1')
    u.searchParams.set('limit', '200')
    u.searchParams.set('access_token', token)
    return u.toString()
  })()

  while (url) {
    const res: Response = await fetch(url)
    if (!res.ok) {
      throw new Error(`Meta Insights API returned ${res.status}: ${await res.text()}`)
    }
    const data: any = await res.json()
    for (const row of data.data || []) {
      results.push({
        platformCampaignId: row.campaign_id,
        campaignName: row.campaign_name,
        spend: parseFloat(row.spend) || 0,
        // With time_increment=1, date_start is the single day this row
        // covers.
        weekStarting: row.date_start,
      })
    }
    url = data.paging?.next || null
  }

  return results
}
