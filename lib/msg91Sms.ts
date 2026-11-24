// path: lib/msg91Sms.ts
// MSG91 SMS for Local Octo only.
//
// The templates are DLT-approved outside the CRM and fixed, so the CRM only
// picks which template goes with which stage and fills its variables from
// the lead. Every send (or skip) is written to the lead's activity log.
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

interface SmsTemplate {
  name: string // MSG91 template name, for the activity log
  templateId: string // MSG91 template ID
  vars: SmsVar[]
}

// Stage key -> MSG91 template. Stages not listed (e.g. manual_lead) send nothing.
export const LOCAL_OCTO_SMS_TEMPLATES: Record<string, SmsTemplate> = {
  new_lead: { name: 'lo_lead', templateId: '6b0593b7054165fed2009633', vars: ['name', 'company', 'phone'] },
  qualified: { name: 'lo_responded', templateId: '6b0594e0996c0ed1b107c195', vars: ['name', 'company', 'phone'] },
  wa_sent: { name: 'lo_call_booked', templateId: '6b059571963d1baca5046b32', vars: ['name', 'date', 'time'] },
  visit_done: { name: 'lo_call_done', templateId: '6b059332fe231d178609b682', vars: ['name', 'company', 'phone'] },
  offer_made: { name: 'lo_offer_made', templateId: '6b0595e20e45d5c9650488d7', vars: ['name', 'company', 'amount', 'date'] },
  accepted: { name: 'lo_accepted', templateId: '6b059699713c1dfdec08b7e2', vars: ['name', 'company', 'link'] },
  enrolled: { name: 'lo_payment_in', templateId: '6b05971d88de262f07041cf2', vars: ['name', 'amount', 'company'] },
  cold: { name: 'lo_cold', templateId: '6b05977c03a33896250e39e5', vars: ['name', 'company', 'phone'] },
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

// Sends the SMS mapped to `stage` for a Local Octo lead. Does nothing for
// other schools or unmapped stages. Never throws.
export async function sendLocalOctoStageSms(params: { clientId: string; lead: any; stage: string }): Promise<void> {
  const { clientId, lead, stage } = params
  try {
    if (!isLocalOcto(clientId)) return
    const tpl = LOCAL_OCTO_SMS_TEMPLATES[stage]
    if (!tpl) return

    const authKey = process.env.MSG91_AUTH_KEY
    if (!authKey) {
      await logActivity(clientId, lead.id, 'SMS Not Sent', `${tpl.name}: MSG91_AUTH_KEY is not set.`)
      return
    }

    const mobile = toDialNumber(lead.whatsapp_number)
    if (!mobile) {
      await logActivity(clientId, lead.id, 'SMS Not Sent', `${tpl.name}: the lead has no phone number.`)
      return
    }

    const built = await buildVars(clientId, lead, stage, tpl)
    if (!built.ok) {
      await logActivity(clientId, lead.id, 'SMS Not Sent', `${tpl.name}: ${MISSING_HINT[built.missing] || built.missing}.`)
      return
    }

    const res = await fetch(MSG91_FLOW_URL, {
      method: 'POST',
      headers: { authkey: authKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        template_id: tpl.templateId,
        short_url: '0',
        recipients: [{ mobiles: mobile, ...built.values }],
      }),
    })
    const data = await res.json().catch(() => ({}))
    const ok = res.ok && data?.type === 'success'

    await logActivity(
      clientId,
      lead.id,
      ok ? 'SMS Sent' : 'SMS Failed',
      ok
        ? `${tpl.name} sent to ${mobile} via MSG91.`
        : `${tpl.name} to ${mobile} failed: ${data?.message || `MSG91 returned ${res.status}`}.`
    )
  } catch (err: any) {
    console.error('[msg91] stage SMS failed', err)
    await logActivity(clientId, lead.id, 'SMS Failed', `Stage "${stage}": ${err?.message || 'request failed'}.`)
  }
}
