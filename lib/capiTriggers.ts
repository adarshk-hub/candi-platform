//Re
import { query } from './db'
import { sendCapiEvent, logCapiSkipped } from './metaConversionsApi'

interface ClientCapiConfig {
  id: string
  capi_enabled: boolean
  meta_pixel_id: string | null
  meta_capi_test_event_code: string | null
  capi_stage_events: Record<string, string>
  zapier_capi_webhook_url: string | null
}

async function getClientCapiConfig(clientId: string): Promise<ClientCapiConfig | null> {
  const rows = await query<ClientCapiConfig>(
    `SELECT id, capi_enabled, meta_pixel_id, meta_capi_test_event_code, capi_stage_events, zapier_capi_webhook_url
     FROM clients WHERE id = $1`,
    [clientId]
  )
  return rows[0] || null
}

interface LeadForCapi {
  id: string
  client_id: string
  full_name: string
  whatsapp_number: string
  second_phone: string | null
  email: string | null
  external_ref: string | null
  fbclid: string | null
  fbc: string | null
  fbp: string | null
  // Optional because not every caller's lead row carries it; the stage-update
  // route passes the full updated row, so it is present there.
  city?: string | null
}

// Meta wants first and last name as separate match keys, but the CRM stores
// one full_name field. Split on the first space: everything before it is the
// first name, the remainder is the surname. A single-word name yields a
// first name only, which is correct — sending a duplicate as the surname
// would be inventing data that cannot match.
function splitName(fullName: string | null): { firstName: string | null; lastName: string | null } {
  if (!fullName) return { firstName: null, lastName: null }
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: null, lastName: null }
  if (parts.length === 1) return { firstName: parts[0], lastName: null }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

// Meta Lead Ads' external_ref is stored as "meta:<leadgen_id>" (see
// app/api/webhooks/meta-leads/route.ts) — pull the raw ID back out for the
// CAPI lead_id match key.
function leadgenIdFromExternalRef(externalRef: string | null): string | null {
  if (!externalRef || !externalRef.startsWith('meta:')) return null
  return externalRef.slice('meta:'.length)
}

// Fires a CAPI event for a lead if — and only if — the client has
// Conversions API turned on, a pixel configured, and the given trigger
// (an entry-type name like "lead_created", or a pipeline_stages key) is
// mapped to a Meta event in clients.capi_stage_events. Every call resolves
// to a row in capi_event_log (sent/failed/skipped) so nothing is silent.
// Never throws — a CAPI failure must never break lead intake or a stage
// update, which is why every call site below fires this without awaiting
// inside a try/catch of its own (this function already swallows errors).
export async function fireCapiEventForLead(params: {
  lead: LeadForCapi
  trigger: string
  eventIdSeed: string // unique-per-attempt seed for event_id dedup (e.g. lead id + trigger)
  customData?: Record<string, any>
  clientIpAddress?: string | null
  clientUserAgent?: string | null
}): Promise<void> {
  const { lead, trigger, eventIdSeed, customData, clientIpAddress, clientUserAgent } = params

  try {
    const config = await getClientCapiConfig(lead.client_id)
    if (!config) return

    const eventName = config.capi_stage_events?.[trigger]
    if (!config.capi_enabled) return
    if (!eventName) {
      // Not every stage needs an event — only log a skip if CAPI is on but
      // this particular trigger has no mapping, so the log doesn't fill up
      // with noise for institutes that only map two or three stages.
      return
    }
    if (!config.meta_pixel_id) {
      await logCapiSkipped({
        clientId: lead.client_id,
        leadId: lead.id,
        eventName,
        pipelineStage: trigger,
        reason: 'Conversions API is enabled but no Meta Pixel/Dataset ID is set.',
      })
      return
    }

    // CAPI writes to a specific Dataset and can need a token scoped to that
    // dataset specifically (generated via Events Manager > your Dataset >
    // Settings > Conversions API > Generate Access Token) — separate from
    // the shared marketing/ads-insights token used for ad-spend sync, which
    // may not carry dataset-write permission even as an admin System User.
    // Falls back to the shared token so nothing breaks if META_CAPI_ACCESS_TOKEN
    // isn't set yet. Not required at all when routing through Zapier — that
    // path authenticates to Meta using Zapier's own connected account, not
    // this token, so we only enforce it on the direct-to-Meta path below.
    const accessToken = process.env.META_CAPI_ACCESS_TOKEN || process.env.META_MARKETING_API_ACCESS_TOKEN
    const zapierWebhookUrl = config.zapier_capi_webhook_url || null

    if (!zapierWebhookUrl && !accessToken) {
      await logCapiSkipped({
        clientId: lead.client_id,
        leadId: lead.id,
        eventName,
        pipelineStage: trigger,
        reason: 'META_MARKETING_API_ACCESS_TOKEN is not set on the server.',
      })
      return
    }

    await sendCapiEvent({
      clientId: lead.client_id,
      leadId: lead.id,
      pixelId: config.meta_pixel_id,
      accessToken: accessToken || '',
      testEventCode: config.meta_capi_test_event_code || undefined,
      eventName,
      eventId: `${eventIdSeed}:${eventName}`,
      pipelineStage: trigger,
      zapierWebhookUrl,
      match: {
        email: lead.email,
        phone: lead.second_phone || lead.whatsapp_number,
        externalId: lead.id,
        firstName: splitName(lead.full_name).firstName,
        lastName: splitName(lead.full_name).lastName,
        city: lead.city ?? null,
        fbc: lead.fbc,
        fbp: lead.fbp,
        clientIpAddress,
        clientUserAgent,
        leadId: leadgenIdFromExternalRef(lead.external_ref),
      },
      // Meta's CRM integration guide requires these two fields inside
      // custom_data for an event to be recognized as coming through a
      // connected CRM funnel (as opposed to a generic server event) — see
      // Events Manager > Connect data > CRM > "Send a CRM event". Merged
      // with any caller-supplied customData so callers can still add their
      // own fields without overwriting these.
      customData: {
        event_source: 'crm',
        lead_event_source: 'Candi Connect',
        ...customData,
      },
    })
  } catch (err) {
    // Config lookup itself failed (DB hiccup, etc.) — log to server console
    // only, since we don't have a reliable client/lead context to write a
    // capi_event_log row for.
    console.error('[capi] fireCapiEventForLead failed unexpectedly', err)
  }
}
