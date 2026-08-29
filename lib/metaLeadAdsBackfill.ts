const GRAPH_API_URL = 'https://graph.facebook.com/v19.0'
import { fetchPageAccessToken } from './metaPages'
import { findGradeValue, mapPlatform } from './metaLeadAds'
import { centralQuery } from './db'
import { findOrCreateLead, findOrCreateCampaign } from './leadIntake'

export interface HistoricalMetaLead {
  leadgenId: string
  createdTime: string // ISO
  formId: string
  formName: string
  fullName: string
  whatsappNumber: string
  email: string | null
  grade: string | null
  campaignId: string | null
  adsetId: string | null
  adId: string | null
  // Same reasoning as the live webhook (lib/metaLeadAds.ts) — a given
  // submission came from either the Facebook or Instagram placement of the
  // same form/campaign, and was previously always hardcoded to 'facebook'.
  source: 'facebook' | 'instagram'
}

// IMPORTANT — a hard limit on Meta's side, not something any code here can
// work around: Meta only retains Lead Ads submission data for 90 days.
// Anything older than that has already been permanently purged from Meta's
// systems by the time this runs, regardless of permissions or token
// validity — the API will simply not return it. If Candid Schools' leads
// predate that window, this can only ever recover the last ~90 days, not
// their full history.
const META_LEAD_RETENTION_DAYS = 90

function fieldValue(fieldData: any[], name: string): string | null {
  const f = fieldData.find((x) => x.name === name)
  return f?.values?.[0] || null
}

// Same fuzzy grade-field detection the live webhook uses (see
// lib/metaLeadAds.ts's findGradeValue) — this used to be a separate,
// exact-match-only "grade"/"class" lookup here, which is very likely why
// grade wasn't populating for leads pulled in through backfill even after
// the live webhook path got the fuzzy match fix.
function findGradeFromFieldData(fieldData: any[]): string | null {
  const fields: Record<string, string> = {}
  for (const f of fieldData) fields[f.name] = f.values?.[0] || ''
  return findGradeValue(fields)
}

// Lists every lead form ever created on the Page, then pages through every
// historical submission for each one. Requires a token with leads_retrieval
// permission that's been added as a partner on the Page itself (Business
// Settings > Accounts > Pages > that Page > Partners) — the same kind of
// asset-assignment step already done for the ad account, just on the Page
// instead.
export async function fetchHistoricalMetaLeads(pageId: string): Promise<HistoricalMetaLead[]> {
  // (#190) "This method must be called with a Page Access Token" — the raw
  // System User token isn't accepted here even with full permissions; see
  // fetchPageAccessToken's comment in metaPages.ts for why.
  const token = await fetchPageAccessToken(pageId)

  const forms: { id: string; name: string }[] = []
  let formsUrl: string | null = `${GRAPH_API_URL}/${pageId}/leadgen_forms?fields=id,name&limit=100&access_token=${token}`
  while (formsUrl) {
    const res: Response = await fetch(formsUrl)
    if (!res.ok) throw new Error(`Graph API (leadgen_forms) returned ${res.status}: ${await res.text()}`)
    const json: any = await res.json()
    for (const f of json.data || []) forms.push({ id: f.id, name: f.name })
    formsUrl = json.paging?.next || null
  }

  const results: HistoricalMetaLead[] = []

  for (const form of forms) {
    let leadsUrl: string | null =
      `${GRAPH_API_URL}/${form.id}/leads?fields=id,created_time,field_data,ad_id,adset_id,campaign_id,platform&limit=100&access_token=${token}`
    while (leadsUrl) {
      const res: Response = await fetch(leadsUrl)
      if (!res.ok) {
        // A single bad/expired form shouldn't kill the whole backfill —
        // log and move on to the next form.
        console.error(`[meta-backfill] leads fetch failed for form ${form.id}: ${res.status} ${await res.text()}`)
        break
      }
      const json: any = await res.json()
      for (const lead of json.data || []) {
        const fieldData = lead.field_data || []
        const grade = findGradeFromFieldData(fieldData)

        // TEMP DIAGNOSTIC — remove once grade capture is confirmed working
        // end to end. Same reasoning as the live webhook's version in
        // lib/metaLeadAds.ts: if this fires, Meta didn't send back any
        // field whose name contains "grade" or "class" for this specific
        // lead — either the form (form.name, logged below) has no grade
        // question, or its wording doesn't match either substring.
        if (!grade) {
          console.log(
            `[meta-backfill] no grade-like field for leadgen_id ${lead.id} (form: ${form.name}). Fields received: ${fieldData.map((f: any) => f.name).join(', ') || '(none)'}`
          )
        }

        results.push({
          leadgenId: lead.id,
          createdTime: lead.created_time,
          formId: form.id,
          formName: form.name,
          fullName: fieldValue(fieldData, 'full_name') || fieldValue(fieldData, 'first_name') || 'Unknown',
          whatsappNumber: fieldValue(fieldData, 'phone_number') || '',
          email: fieldValue(fieldData, 'email'),
          grade,
          campaignId: lead.campaign_id || null,
          adsetId: lead.adset_id || null,
          adId: lead.ad_id || null,
          source: mapPlatform(lead.platform),
        })
      }
      leadsUrl = json.paging?.next || null
    }
  }

  return results
}

export { META_LEAD_RETENTION_DAYS }

export interface BackfillOneClientResult {
  clientId: string
  ok: boolean
  error?: string
  totalFound?: number
  created?: number
  duplicate?: number
}

// The actual "pull historical Meta leads and create/merge them" flow for
// one client — shared by the session-gated per-client route (the Dashboard
// "Backfill Meta Lead Ads leads" button) and the secret-gated cron route
// that loops over every client. Session-independent throughout: takes an
// explicit clientId and meta_page_id rather than inferring either from a
// logged-in session, since the cron path has no session at all.
export async function backfillMetaLeadsForClient(clientId: string, metaPageId: string): Promise<BackfillOneClientResult> {
  let historicalLeads: HistoricalMetaLead[]
  try {
    historicalLeads = await fetchHistoricalMetaLeads(metaPageId)
  } catch (err: any) {
    return { clientId, ok: false, error: err?.message || 'Failed to fetch historical leads from Meta' }
  }

  let created = 0
  let duplicate = 0
  const campaignIdCache = new Map<string, string>()

  for (const hl of historicalLeads) {
    let internalCampaignId: string | null = null
    if (hl.campaignId) {
      const cacheKey = `${hl.campaignId}:${hl.adsetId}:${hl.adId}`
      internalCampaignId =
        campaignIdCache.get(cacheKey) ||
        (await findOrCreateCampaign({
          clientId,
          platform: 'meta',
          platformCampaignId: hl.campaignId,
          platformAdsetId: hl.adsetId,
          platformAdId: hl.adId,
          adSetLabel: hl.adsetId ? `Ad set ${hl.adsetId}` : null,
        }))
      campaignIdCache.set(cacheKey, internalCampaignId)
    }

    const result = await findOrCreateLead({
      clientId,
      fullName: hl.fullName,
      whatsappNumber: hl.whatsappNumber,
      email: hl.email,
      grade: hl.grade,
      source: hl.source,
      entryType: 'meta_form_backfill',
      campaignId: internalCampaignId,
      externalRef: `meta:${hl.leadgenId}`,
      rawPayload: { formId: hl.formId, formName: hl.formName, backfilled: true, originalCreatedTime: hl.createdTime },
      createdAt: hl.createdTime,
    })

    if (result.created) created++
    else duplicate++
  }

  return { clientId, ok: true, totalFound: historicalLeads.length, created, duplicate }
}

// Runs backfillMetaLeadsForClient for every client that has a Meta Page ID
// configured — the cron entry point. Client list comes from the central
// registry (see lib/db.ts), same reasoning as adSpendSync: this needs every
// institute, not whichever one a session happens to be scoped to, and a
// cron trigger has no session at all.
export async function backfillMetaLeadsForAllClients(): Promise<BackfillOneClientResult[]> {
  const clients = await centralQuery<{ id: string; meta_page_id: string | null }>(
    `SELECT id, meta_page_id FROM clients WHERE meta_page_id IS NOT NULL`
  )
  const results: BackfillOneClientResult[] = []
  for (const client of clients) {
    if (!client.meta_page_id) continue
    results.push(await backfillMetaLeadsForClient(client.id, client.meta_page_id))
  }
  return results
}
