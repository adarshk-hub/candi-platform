// path: lib/counsellorAlerts.ts
import { query } from '@/lib/db'
import { sendTemplateMessage, sendTextMessage } from '@/lib/metaWhatsapp'

// Meta only delivers a plain text message inside the 24 hours after that
// person last messaged the school's number. A counsellor almost never has,
// so an approved template is what makes these alerts actually arrive. This
// is the template used, one free-text variable carrying the whole line.
// Two utility templates, one per kind of alert. Meta reviews wording, and
// a template that is almost entirely variables tends to be rejected, so
// each body carries real sentence text around its placeholders.
export const COUNSELLOR_ALERT_TEMPLATES = [
  {
    name: 'counsellor_new_lead',
    category: 'UTILITY' as const,
    // {{1}} parent name, {{2}} phone, {{3}} source
    body:
      'New enquiry received. Parent: {{1}}. Phone: {{2}}. Source: {{3}}. Please open Candi Connect to call and update the lead.',
  },
  {
    name: 'counsellor_booking_alert',
    category: 'UTILITY' as const,
    // {{1}} call/visit, {{2}} parent name, {{3}} date and time
    body:
      'A {{1}} has been booked with {{2}} for {{3}}. Please open Candi Connect to review the details and prepare for it.',
  },
]

export const NEW_LEAD_TEMPLATE = COUNSELLOR_ALERT_TEMPLATES[0].name
export const BOOKING_TEMPLATE = COUNSELLOR_ALERT_TEMPLATES[1].name

// Phone numbers get typed in every shape. Meta wants digits with a country
// code and nothing else, and a bare 10-digit Indian mobile is the most
// common way to get this silently wrong.
export function normalizePhone(raw: string | null | undefined): string {
  const digits = (raw || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 10) return `91${digits}`
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`
  return digits
}

// WhatsApp alerts to counsellors: a new lead arrived, or a call/visit was
// booked on a lead. Entirely opt-in — a counsellor with no phone number
// saved gets nothing, which is the default for everybody.
//
// Every school is its own Postgres schema, so users.phone is added on
// demand rather than through a migration that has to be run five times.
const columnReady = new Map<string, boolean>()

export async function ensurePhoneColumn(): Promise<boolean> {
  try {
    const [row] = await query<{ schema: string; present: boolean }>(
      `SELECT current_schema() AS schema,
              EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'users' AND column_name = 'phone'
              ) AS present`
    )
    const key = row?.schema || 'unknown'
    if (columnReady.get(key)) return true
    if (row?.present) {
      columnReady.set(key, true)
      return true
    }
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR`)
    columnReady.set(key, true)
    return true
  } catch (err) {
    console.error('[counsellorAlerts] could not add users.phone:', err)
    return false
  }
}

// SELECT fragment, so a query still works on a schema where the column
// hasn't been added yet.
export async function phoneSelect(alias = 'u'): Promise<string> {
  return (await ensurePhoneColumn()) ? `${alias}.phone` : `NULL::varchar AS phone`
}

interface Recipient {
  id: string
  full_name: string | null
  phone: string
}

// Who hears about this lead: the counsellor it is assigned to, or — when
// nobody owns it yet — every counsellor at that institute who has saved a
// number, so a new lead is never announced to no one.
async function recipientsFor(clientId: string, assignedCounsellorId: string | null): Promise<Recipient[]> {
  if (!(await ensurePhoneColumn())) return []
  try {
    if (assignedCounsellorId) {
      return await query<Recipient>(
        `SELECT id, full_name, phone FROM users
         WHERE id = $1 AND phone IS NOT NULL AND phone <> '' AND COALESCE(is_active, true)`,
        [assignedCounsellorId]
      )
    }
    return await query<Recipient>(
      `SELECT id, full_name, phone FROM users
       WHERE client_id = $1 AND role = 'client_counsellor'
         AND phone IS NOT NULL AND phone <> '' AND COALESCE(is_active, true)`,
      [clientId]
    )
  } catch (err) {
    console.error('[counsellorAlerts] could not load recipients:', err)
    return []
  }
}

// A counsellor is a staff member, not a customer: they are messaged from
// the school's own number, so an approved template is used when one exists
// and a plain text message otherwise (which reaches anyone who has messaged
// the school in the last 24 hours). Alerts are best-effort by design — a
// WhatsApp failure must never block a lead being created or a visit booked.
async function deliver(clientId: string, to: string, templateName: string, values: string[], text: string) {
  const number = normalizePhone(to)
  if (!number) return
  try {
    const [tpl] = await query<{ name: string; language: string }>(
      `SELECT name, language FROM wa_templates
       WHERE client_id = $1 AND status = 'approved' AND name ILIKE $2
       ORDER BY submitted_at DESC LIMIT 1`,
      [clientId, `%${templateName}%`]
    )
    if (tpl) {
      const res = await sendTemplateMessage({
        clientId,
        to: number,
        templateName: tpl.name,
        languageCode: tpl.language || 'en',
        components: [{ type: 'body', parameters: values.map((v) => ({ type: 'text', text: v || '-' })) }],
      })
      if (res.ok) return
      console.error(`[counsellorAlerts] template "${tpl.name}" failed:`, res.error)
    }
    // No approved alert template: try plain text, which only lands if this
    // counsellor has messaged the school number in the last 24 hours. The
    // log line says so, because otherwise a silent non-delivery looks like
    // the feature doing nothing at all.
    const res = await sendTextMessage({ clientId, to: number, body: text })
    if (!res.ok) {
      console.error(
        `[counsellorAlerts] not delivered to ${number}. Submit and approve the "${templateName}" template so alerts work outside the 24-hour window. Reason:`,
        res.error
      )
    }
  } catch (err) {
    console.error('[counsellorAlerts] send failed:', err)
  }
}

async function notify(
  clientId: string,
  assignedCounsellorId: string | null,
  templateName: string,
  values: string[],
  text: string
) {
  const people = await recipientsFor(clientId, assignedCounsellorId)
  for (const person of people) {
    await deliver(clientId, person.phone, templateName, values, text)
  }
}

// Fired for every new lead, whatever the source — the web form, a Meta or
// Google ad, WhatsApp, an import, or Add Lead in the CRM.
export async function notifyNewLead(params: {
  clientId: string
  assignedCounsellorId?: string | null
  leadName?: string | null
  phone?: string | null
  source?: string | null
}) {
  const name = (params.leadName || '').trim() || 'New enquiry'
  const phone = (params.phone || '').trim() || 'not given'
  const source = (params.source || '').trim() || 'direct'
  await notify(
    params.clientId,
    params.assignedCounsellorId || null,
    NEW_LEAD_TEMPLATE,
    [name, phone, source],
    `New enquiry received. Parent: ${name}. Phone: ${phone}. Source: ${source}. Open Candi Connect to follow up.`
  )
}

// Fired when a call or visit is booked from the lead panel.
export async function notifyBooking(params: {
  clientId: string
  assignedCounsellorId?: string | null
  leadName?: string | null
  kind: 'call' | 'visit'
  when?: string | null
}) {
  const name = (params.leadName || '').trim() || 'a parent'
  const kind = params.kind === 'visit' ? 'campus visit' : 'call'
  const when = (params.when || '').trim() || 'a new time'
  await notify(
    params.clientId,
    params.assignedCounsellorId || null,
    BOOKING_TEMPLATE,
    [kind, name, when],
    `A ${kind} has been booked with ${name} for ${when}. Open Candi Connect for the details.`
  )
}
