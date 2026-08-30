//Re
import crypto from 'crypto'
import { query } from './db'

const META_API_VERSION = process.env.META_MARKETING_API_VERSION || 'v19.0'

// Re-exported for convenience so server code can `import { META_STANDARD_EVENTS } from './metaConversionsApi'`
// — the canonical definition lives in lib/types.ts because that file is
// also safe to import from client components. See the comment there.
export { META_STANDARD_EVENTS } from './types'

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex')
}

// Meta requires phone numbers in the hashed match key to be digits-only
// with country code, no leading zeros/symbols. We don't reliably know the
// country code for every number in this CRM (leads.whatsapp_number is
// stored however it was submitted), so we assume India (+91) when a raw
// 10-digit number is given — correct for the overwhelming majority of leads
// in this app's actual usage, but worth revisiting if an institute starts
// taking international enquiries.
function normalizePhoneForHash(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `91${digits}`
  return digits
}

export interface CapiMatchKeys {
  email?: string | null
  phone?: string | null
  externalId?: string | null
  fbc?: string | null
  fbp?: string | null
  clientIpAddress?: string | null
  clientUserAgent?: string | null
  // Meta Lead Ads' own lead_id — the strongest possible match key for a
  // lead that originated from a Lead Ads form, per Meta's own CAPI docs.
  leadId?: string | null
}

export interface SendCapiEventParams {
  clientId: string
  leadId?: string | null
  pixelId: string
  accessToken: string
  testEventCode?: string | null
  eventName: string
  eventId: string
  eventTime?: number // unix seconds, defaults to now
  match: CapiMatchKeys
  pipelineStage?: string | null
  customData?: Record<string, any>
  eventSourceUrl?: string | null
  // When set, the event is handed to this Zapier "Catch Hook" URL instead
  // of being POSTed to graph.facebook.com directly. Everything else about
  // this function — the payload shape, the capi_event_log row, the return
  // value — stays the same either way. Leave unset (the default for every
  // existing client) to keep sending straight to Meta exactly as before.
  zapierWebhookUrl?: string | null
}

export interface SendCapiEventResult {
  ok: boolean
  fbtraceId?: string
  error?: string
}

// Sends one server-side event to Meta's Conversions API and writes an audit
// row to capi_event_log regardless of outcome — that log is what the
// Settings UI reads to show "is this actually working". Never throws: a
// failed Meta call should show up as a red row in the log, not break the
// lead-creation or stage-update request that triggered it.
export async function sendCapiEvent(params: SendCapiEventParams): Promise<SendCapiEventResult> {
  const {
    clientId,
    leadId = null,
    pixelId,
    accessToken,
    testEventCode,
    eventName,
    eventId,
    eventTime = Math.floor(Date.now() / 1000),
    match,
    pipelineStage = null,
    customData,
    eventSourceUrl,
    zapierWebhookUrl,
  } = params

  const userData: Record<string, any> = {}
  if (match.email) userData.em = [sha256(match.email)]
  if (match.phone) userData.ph = [sha256(normalizePhoneForHash(match.phone))]
  if (match.externalId) userData.external_id = [sha256(match.externalId)]
  if (match.fbc) userData.fbc = match.fbc
  if (match.fbp) userData.fbp = match.fbp
  if (match.clientIpAddress) userData.client_ip_address = match.clientIpAddress
  if (match.clientUserAgent) userData.client_user_agent = match.clientUserAgent
  if (match.leadId) userData.lead_id = match.leadId

  const eventPayload = {
    event_name: eventName,
    event_time: eventTime,
    event_id: eventId,
    action_source: 'system_generated',
    ...(eventSourceUrl ? { event_source_url: eventSourceUrl } : {}),
    user_data: userData,
    ...(customData ? { custom_data: customData } : {}),
  }

  const body: Record<string, any> = {
    data: [eventPayload],
    access_token: accessToken,
  }
  if (testEventCode) body.test_event_code = testEventCode

  let result: SendCapiEventResult
  try {
    if (zapierWebhookUrl) {
      // Zapier path: hand off the raw event data to a Zapier "Catch Hook"
      // trigger instead of calling Meta ourselves. We send both the raw,
      // unhashed match fields (Zapier's native Meta Conversions API action
      // hashes email/phone itself) and the already-built Meta-shaped event,
      // so whichever your Zap ends up using is available without a second
      // round of changes here. NOTE: a 2xx from this webhook only confirms
      // Zapier received it — not that Meta accepted it. Check the Zap's own
      // run history (or Meta Events Manager) to confirm actual delivery;
      // this function has no way to know that part.
      const res = await fetch(zapierWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          lead_id: leadId,
          pixel_id: pixelId,
          event_name: eventName,
          event_id: eventId,
          event_time: eventTime,
          pipeline_stage: pipelineStage,
          test_event_code: testEventCode || undefined,
          email: match.email || undefined,
          phone: match.phone || undefined,
          external_id: match.externalId || undefined,
          fbc: match.fbc || undefined,
          fbp: match.fbp || undefined,
          meta_lead_id: match.leadId || undefined,
          custom_data: customData || undefined,
          // Full Meta-shaped payload too, in case your Zap forwards this
          // verbatim rather than remapping fields from the flat ones above.
          meta_event_payload: eventPayload,
        }),
      })
      if (res.ok) {
        result = { ok: true }
      } else {
        const text = await res.text().catch(() => '')
        result = { ok: false, error: `Zapier webhook returned ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}` }
      }
    } else {
      const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        result = { ok: false, error: json?.error?.message || `Meta returned ${res.status}`, fbtraceId: json?.error?.fbtrace_id }
      } else {
        // Meta can return HTTP 200 with a valid fbtrace_id while actually
        // processing zero events (bad event_time, dataset state, etc.),
        // explained in `messages`. Treat that as a failure too, or a broken
        // integration looks identical to a working one from this log alone.
        const received = typeof json?.events_received === 'number' ? json.events_received : undefined
        if (received === 0) {
          const detail = Array.isArray(json?.messages) && json.messages.length
            ? JSON.stringify(json.messages)
            : 'no explanation returned'
          result = {
            ok: false,
            error: `Meta accepted the request but processed 0 events (${detail})`,
            fbtraceId: json?.fbtrace_id,
          }
        } else {
          result = { ok: true, fbtraceId: json?.fbtrace_id }
        }
      }
    }
  } catch (err: any) {
    result = { ok: false, error: err?.message || `Network error calling ${zapierWebhookUrl ? 'the Zapier webhook' : 'Meta Conversions API'}` }
  }

  await query(
    `INSERT INTO capi_event_log (client_id, lead_id, event_name, event_id, pipeline_stage, status, fbtrace_id, error, request_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      clientId,
      leadId,
      eventName,
      eventId,
      pipelineStage,
      result.ok ? 'sent' : 'failed',
      result.fbtraceId || (zapierWebhookUrl && result.ok ? 'via Zapier — not Meta-confirmed' : null),
      result.error || null,
      JSON.stringify(eventPayload),
    ]
  )

  return result
}

// Logs a "skipped" row (no pixel configured, CAPI off, stage not mapped,
// etc.) so the Settings log tells the full story of why an event didn't go
// out, instead of just going quiet.
export async function logCapiSkipped(params: {
  clientId: string
  leadId?: string | null
  eventName: string
  pipelineStage?: string | null
  reason: string
}): Promise<void> {
  await query(
    `INSERT INTO capi_event_log (client_id, lead_id, event_name, event_id, pipeline_stage, status, error)
     VALUES ($1,$2,$3,$4,$5,'skipped',$6)`,
    [params.clientId, params.leadId || null, params.eventName, `skipped:${Date.now()}`, params.pipelineStage || null, params.reason]
  )
}
