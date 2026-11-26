// path: lib/msg91Sms.ts
// MSG91 SMS for Local Octo only.
//
// The templates are DLT-approved outside the CRM and fixed, so the CRM only
// picks which template goes with which stage and fills its variables from
// the lead. Every send (or skip) is written to the lead's activity log.
//
// Each stage has a mode, set in Settings > SMS (clients.sms_stage_modes):
//   auto   — sent the moment the lead reaches the stage
//   manual — the CRM asks before sending (SmsStagePrompt)
//   off    — never sent (the default until set)
//
// Vercel env vars:
//   MSG91_AUTH_KEY           MSG91 auth key (secret)
//   LOCAL_OCTO_SMS_PHONE     support number shown in the SMS (##phone##)
//   LOCAL_OCTO_PAYMENT_LINK  payment link for the Accepted SMS (##link##)
import { queryAsClient } from './db'
import { isLocalOcto } from './localOcto'
import { toDialNumber } from './leadIntake'

const MSG91_FLOW_URL = 'https://control.msg91.com/api/v5/flow'

// Local Octo plan price (Rs per month), used for ##amount##.
const LOCAL_OCTO_PLAN_AMOUNT = '19497'
// "Valid till" date on the offer SMS = today + this many days.
const OFFER_VALID_DAYS = 7

type SmsVar = 'name' | 'company' | 'phone' | 'date' | 'time' | 'amount' | 'link'

export type SmsMode = 'auto' | 'manual' | 'off'

interface SmsTemplate {
  name: string // MSG91 template name, for the activity log
  templateId: string // MSG91 template ID
  vars: SmsVar[]
  text: string // approved wording, shown in Settings and the send prompt
}

// Stage key -> MSG91 template. Stages not listed (e.g. manual_lead) send nothing.
export const LOCAL_OCTO_SMS_TEMPLATES: Record<string, SmsTemplate> = {
  new_lead: { name: 'lo_lead', templateId: '6b0593b7054165fed2009633', vars: ['name', 'company', 'phone'],
    text: 'Hi ##name##, thanks for your interest in Local Octo for ##company##. Our team will call you shortly. Call ##phone## for help. -Local Octo',
  },
  qualified: { name: 'lo_responded', templateId: '6b0594e0996c0ed1b107c195', vars: ['name', 'company', 'phone'],
    text: 'Hi ##name##, we received your reply to your enquiry for Google Maps ranking and review management for ##company##. Our team will call you shortly. Call ##phone## for any doubts. - Local Octo',
  },
  wa_sent: { name: 'lo_call_booked', templateId: '6b059571963d1baca5046b32', vars: ['name', 'date', 'time'],
    text: 'Hi ##name##, your call with Local Octo is confirmed for ##date## at ##time##. Our expert will call you on this number. -Local Octo',
  },
  visit_done: { name: 'lo_call_done', templateId: '6b059332fe231d178609b682', vars: ['name', 'company', 'phone'],
    text: 'Hi ##name##, thank you for the consultation call today for ##company##. The proposal discussed on the call is here: https://localocto.com Call ##phone## for any questions. - Local Octo',
  },
  offer_made: { name: 'lo_offer_made', templateId: '6b0595e20e45d5c9650488d7', vars: ['name', 'company', 'amount', 'date'],
    text: 'Hi ##name##, as discussed, the Local Octo Done For You plan for ##company## is ready at Rs ##amount## per month. View plan details: https://localocto.com Valid till ##date##. - Local Octo',
  },
  accepted: { name: 'lo_accepted', templateId: '6b059699713c1dfdec08b7e2', vars: ['name', 'company', 'link'],
    text: 'Hi ##name##, thank you for choosing Local Octo for ##company##. Complete your payment here: ##link## -Local Octo',
  },
  enrolled: { name: 'lo_payment_in', templateId: '6b05971d88de262f07041cf2', vars: ['name', 'amount', 'company'],
    text: 'Hi ##name##, we have received your payment of Rs ##amount## for ##company##. Our team will start work shortly. -Local Octo',
  },
  cold: { name: 'lo_cold', templateId: '6b05977c03a33896250e39e5', vars: ['name', 'company', 'phone'],
    text: 'Hi ##name##, want more calls for ##company## from Google Maps? Local Octo can help. Call ##phone## to get started. -Local Octo',
  },
}

// DLT allows at most 30 characters per variable.
function clip(v: string | null | undefined): string {
  return String(v || '').trim().slice(0, 30)
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

async function logActivity(clientId: string, leadId: string, title: string, description: string) {
  await queryAsClient(
    clientId,
    `INSERT INTO activity_log (lead_id, activity_type, title, description) VALUES ($1, 'system', $2, $3)`,
    [leadId, title, description]
  ).catch(() => {})
}

// Builds the variable values for one template from CRM data. Returns the
// first missing variable instead, so the SMS is skipped rather than sent
// with a blank in it.
async function buildVars(
  clientId: string,
  lead: any,
  stage: string,
  tpl: SmsTemplate
): Promise<{ ok: true; values: Record<string, string> } | { ok: false; missing: string }> {
  const values: Record<string, string> = {}

  // Call Booked: date/time of the lead's latest booked call/visit.
  let booking: { d: string; t: string } | null = null
  if (tpl.vars.includes('time')) {
    const [row] = await queryAsClient<{ d: string; t: string }>(
      clientId,
      `SELECT to_char(event_date, 'FMDD Mon YYYY') AS d, to_char(event_time, 'FMHH12:MI AM') AS t
       FROM events
       WHERE lead_id = $1 AND status IN ('scheduled', 'confirmed') AND event_date IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [lead.id]
    )
    booking = row || null
  }

  for (const v of tpl.vars) {
    let value = ''
    switch (v) {
      case 'name':
        value = lead.full_name
        break
      case 'company':
        // Local Octo shows the child_name field as "Company Name".
        value = lead.child_name || lead.company_name
        break
      case 'phone':
        value = process.env.LOCAL_OCTO_SMS_PHONE || ''
        break
      case 'amount':
        value = LOCAL_OCTO_PLAN_AMOUNT
        break
      case 'link':
        value = process.env.LOCAL_OCTO_PAYMENT_LINK || ''
        break
      case 'date':
        if (stage === 'offer_made') {
          value = formatDate(new Date(Date.now() + OFFER_VALID_DAYS * 86400000))
        } else {
          value = booking?.d || ''
        }
        break
      case 'time':
        value = booking?.t || ''
        break
    }
    value = clip(value)
    if (!value) return { ok: false, missing: v }
    values[v] = value
  }
  return { ok: true, values }
}

const MISSING_HINT: Record<string, string> = {
  name: 'the lead has no Full Name',
  company: 'the lead has no Company Name',
  phone: 'LOCAL_OCTO_SMS_PHONE is not set',
  link: 'LOCAL_OCTO_PAYMENT_LINK is not set',
  date: 'no call is booked for this lead (book the call first)',
  time: 'no call is booked for this lead (book the call first)',
  amount: 'no amount',
}

export async function getSmsModes(clientId: string): Promise<Record<string, SmsMode>> {
  try {
    const [row] = await queryAsClient<{ sms_stage_modes: Record<string, SmsMode> | null }>(
      clientId,
      'SELECT sms_stage_modes FROM clients WHERE id = $1',
      [clientId]
    )
    return row?.sms_stage_modes || {}
  } catch {
    return {} // column not added yet — everything counts as off
  }
}

export interface SmsSendResult {
  ok: boolean
  skipped?: boolean
  error?: string
}

// 'auto'      — a stage change / new lead; only if the stage is Automatic
// 'manual'    — Send clicked in the "Ask before sending" prompt; unless Off
// 'direct'    — sent by hand from the lead's SMS tab (any template)
// 'broadcast' — part of an SMS broadcast
export type SmsTrigger = 'auto' | 'manual' | 'direct' | 'broadcast' | 'booking'

function renderText(tpl: SmsTemplate, values: Record<string, string>): string {
  return tpl.text.replace(/##(\w+)##/g, (_, k) => values[k] ?? '')
}

// Phone number + variable values for one lead, or the reason it can't be sent.
async function prepareRecipient(
  clientId: string,
  lead: any,
  stage: string,
  tpl: SmsTemplate
): Promise<{ ok: true; mobile: string; values: Record<string, string> } | { ok: false; why: string }> {
  const mobile = toDialNumber(lead.whatsapp_number)
  if (!mobile) return { ok: false, why: 'the lead has no phone number' }
  const built = await buildVars(clientId, lead, stage, tpl)
  if (!built.ok) return { ok: false, why: MISSING_HINT[built.missing] || built.missing }
  return { ok: true, mobile, values: built.values }
}

// One MSG91 Flow call; MSG91 takes many recipients, each with their own values.
async function postFlow(
  tpl: SmsTemplate,
  recipients: Array<{ mobile: string; values: Record<string, string> }>
): Promise<{ ok: boolean; requestId?: string; error?: string }> {
  const authKey = process.env.MSG91_AUTH_KEY
  if (!authKey) return { ok: false, error: 'MSG91_AUTH_KEY is not set' }
  const res = await fetch(MSG91_FLOW_URL, {
    method: 'POST',
    headers: { authkey: authKey, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      template_id: tpl.templateId,
      short_url: '0',
      recipients: recipients.map((r) => ({ mobiles: r.mobile, ...r.values })),
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (res.ok && data?.type === 'success') return { ok: true, requestId: String(data?.message || '') }
  return { ok: false, error: String(data?.message || `MSG91 returned ${res.status}`) }
}

// Successful sends only — this table is what the SMS Inbox shows.
async function recordSent(
  clientId: string,
  row: {
    leadId: string
    stage: string
    tpl: SmsTemplate
    mobile: string
    body: string
    trigger: SmsTrigger
    sentBy?: string | null
    broadcastName?: string | null
    requestId?: string
  }
) {
  await queryAsClient(
    clientId,
    `INSERT INTO sms_messages (lead_id, stage_key, template_name, mobile, body, trigger, sent_by, broadcast_name, msg91_request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      row.leadId,
      row.stage,
      row.tpl.name,
      row.mobile,
      row.body,
      row.trigger,
      row.sentBy || null,
      row.broadcastName || null,
      row.requestId || null,
    ]
  ).catch((err) => console.error('[msg91] could not record sent SMS', err))
}

// Sends one stage's SMS to one Local Octo lead. Does nothing for other
// schools or unmapped stages. Never throws.
export async function sendLocalOctoStageSms(params: {
  clientId: string
  lead: any
  stage: string
  trigger: SmsTrigger
  sentBy?: string | null
}): Promise<SmsSendResult> {
  const { clientId, lead, stage, trigger, sentBy } = params
  try {
    if (!isLocalOcto(clientId)) return { ok: false, skipped: true }
    const tpl = LOCAL_OCTO_SMS_TEMPLATES[stage]
    if (!tpl) return { ok: false, skipped: true }

    // The stage settings only govern stage-driven sends.
    if (trigger === 'auto' || trigger === 'manual') {
      const mode = (await getSmsModes(clientId))[stage] || 'off'
      if (mode === 'off') return { ok: false, skipped: true, error: 'SMS is off for this stage.' }
      if (trigger === 'auto' && mode !== 'auto') return { ok: false, skipped: true }
    }

    const prep = await prepareRecipient(clientId, lead, stage, tpl)
    if (!prep.ok) {
      await logActivity(clientId, lead.id, 'SMS Not Sent', `${tpl.name}: ${prep.why}.`)
      return { ok: false, error: prep.why }
    }

    const sent = await postFlow(tpl, [{ mobile: prep.mobile, values: prep.values }])
    if (!sent.ok) {
      await logActivity(clientId, lead.id, 'SMS Failed', `${tpl.name} to ${prep.mobile} failed: ${sent.error}.`)
      return { ok: false, error: sent.error }
    }

    const body = renderText(tpl, prep.values)
    await recordSent(clientId, { leadId: lead.id, stage, tpl, mobile: prep.mobile, body, trigger, sentBy, requestId: sent.requestId })
    await logActivity(clientId, lead.id, 'SMS Sent', `${tpl.name} sent to ${prep.mobile} via MSG91: "${body}"`)
    return { ok: true }
  } catch (err: any) {
    console.error('[msg91] stage SMS failed', err)
    await logActivity(clientId, lead.id, 'SMS Failed', `Stage "${stage}": ${err?.message || 'request failed'}.`)
    return { ok: false, error: err?.message || 'request failed' }
  }
}

const BROADCAST_BATCH = 100

// Sends one template to many Local Octo leads, MSG91 recipients batched 100
// per call. Leads missing a value (e.g. no Company Name) are skipped.
export async function sendLocalOctoSmsBroadcast(params: {
  clientId: string
  stage: string
  leads: any[]
  sentBy?: string | null
  broadcastName?: string | null
}): Promise<{ sent: number; skipped: number; failed: number; errors: string[] }> {
  const { clientId, stage, leads, sentBy, broadcastName } = params
  const out = { sent: 0, skipped: 0, failed: 0, errors: [] as string[] }
  const tpl = LOCAL_OCTO_SMS_TEMPLATES[stage]
  if (!isLocalOcto(clientId) || !tpl) {
    out.errors.push('SMS is not set up for this template.')
    return out
  }

  const ready: Array<{ lead: any; mobile: string; values: Record<string, string> }> = []
  for (const lead of leads) {
    const prep = await prepareRecipient(clientId, lead, stage, tpl)
    if (prep.ok) ready.push({ lead, mobile: prep.mobile, values: prep.values })
    else out.skipped++
  }

  for (let i = 0; i < ready.length; i += BROADCAST_BATCH) {
    const batch = ready.slice(i, i + BROADCAST_BATCH)
    const sent = await postFlow(tpl, batch).catch((err: any) => ({ ok: false, error: err?.message, requestId: undefined }))
    if (!sent.ok) {
      out.failed += batch.length
      if (sent.error && !out.errors.includes(sent.error)) out.errors.push(sent.error)
      continue
    }
    out.sent += batch.length
    for (const r of batch) {
      const body = renderText(tpl, r.values)
      await recordSent(clientId, {
        leadId: r.lead.id,
        stage,
        tpl,
        mobile: r.mobile,
        body,
        trigger: 'broadcast',
        sentBy,
        broadcastName,
        requestId: sent.requestId,
      })
      await logActivity(
        clientId,
        r.lead.id,
        'SMS Sent',
        `${tpl.name} sent via SMS broadcast${broadcastName ? ` "${broadcastName}"` : ''}: "${body}"`
      )
    }
  }
  return out
}

// Sends any DLT-approved MSG91 template (not tied to a stage) to one lead,
// with the variable values already worked out by the caller. Used by booking
// notifications (lib/bookingNotify.ts), whose templates are saved in
// Settings. Records successful sends for the SMS Inbox and logs the result
// on the lead. Never throws.
export async function sendMsg91TemplateToLead(params: {
  clientId: string
  lead: any
  template: { name: string; templateId: string; text: string }
  values: Record<string, string>
  trigger: SmsTrigger
  stageKey: string
  sentBy?: string | null
}): Promise<SmsSendResult> {
  const { clientId, lead, template, values, trigger, stageKey, sentBy } = params
  try {
    const mobile = toDialNumber(lead.whatsapp_number)
    if (!mobile) {
      await logActivity(clientId, lead.id, 'SMS Not Sent', `${template.name}: the lead has no phone number.`)
      return { ok: false, error: 'the lead has no phone number' }
    }
    // Every ##variable## in the approved text must have a value (max 30 chars, DLT's limit).
    const clipped: Record<string, string> = {}
    for (const m of template.text.matchAll(/##(\w+)##/g)) {
      const v = clip(values[m[1]])
      if (!v) {
        await logActivity(clientId, lead.id, 'SMS Not Sent', `${template.name}: no value for ##${m[1]}##.`)
        return { ok: false, error: `no value for ##${m[1]}##` }
      }
      clipped[m[1]] = v
    }
    const tpl: SmsTemplate = { name: template.name, templateId: template.templateId, vars: [], text: template.text }
    const sent = await postFlow(tpl, [{ mobile, values: clipped }])
    if (!sent.ok) {
      await logActivity(clientId, lead.id, 'SMS Failed', `${template.name} to ${mobile} failed: ${sent.error}.`)
      return { ok: false, error: sent.error }
    }
    const body = renderText(tpl, clipped)
    await recordSent(clientId, { leadId: lead.id, stage: stageKey, tpl, mobile, body, trigger, sentBy, requestId: sent.requestId })
    await logActivity(clientId, lead.id, 'SMS Sent', `${template.name} sent to ${mobile} via MSG91: "${body}"`)
    return { ok: true }
  } catch (err: any) {
    console.error('[msg91] template SMS failed', err)
    return { ok: false, error: err?.message || 'request failed' }
  }
}
