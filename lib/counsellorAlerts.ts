// path: lib/counsellorAlerts.ts
import { query, queryAsClient } from '@/lib/db'

// Alerts fire from webhooks and cron (a Meta lead form, the intake queue),
// where there is no logged-in session for query() to resolve a database
// from — so every call here names the institute explicitly.
function db(clientId?: string | null) {
  return <T = any>(text: string, params?: any[]): Promise<T[]> =>
    clientId ? queryAsClient<T>(clientId, text, params) : query<T>(text, params)
}
import { sendTemplateMessage, sendTextMessage } from '@/lib/metaWhatsapp'

// Meta only delivers a plain text message inside the 24 hours after that
// person last messaged the school's number. A counsellor almost never has,
// so an approved template is what makes these alerts actually arrive. This
// is the template used, one free-text variable carrying the whole line.
// The two approved templates these alerts are sent with. Create them by
// hand on the WhatsApp Templates page with exactly these names; the body
// wording is yours to choose, but the variable order has to match:
//
//   counsellor_new_lead       {{1}} parent name, {{2}} phone, {{3}} source
//   counsellor_booking_alert  {{1}} call or campus visit, {{2}} parent name,
//                             {{3}} date and time
//
// Until a template exists and Meta has approved it, the alert falls back to
// plain text, which WhatsApp only delivers within 24 hours of that person
// last messaging the school's number.
export const NEW_LEAD_TEMPLATE = 'counsellor_new_lead'
export const BOOKING_TEMPLATE = 'counsellor_booking_alert'

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

export async function ensurePhoneColumn(clientId?: string | null): Promise<boolean> {
  try {
    const [row] = await db(clientId)<{ schema: string; present: boolean }>(
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
    await db(clientId)(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR`)
    columnReady.set(key, true)
    return true
  } catch (err) {
    console.error('[counsellorAlerts] could not add users.phone:', err)
    return false
  }
}

// SELECT fragment, so a query still works on a schema where the column
// hasn't been added yet.
export async function phoneSelect(alias = 'u', clientId?: string | null): Promise<string> {
  return (await ensurePhoneColumn(clientId)) ? `${alias}.phone` : `NULL::varchar AS phone`
}

// Where a number lives when users.phone cannot be added — some schemas are
// owned by a role that may write rows but not alter tables, and a number
// that silently vanishes on save is worse than no feature at all.
// client_option_items is an existing table the settings screens already
// write to, so one row per counsellor goes there instead.
const PHONE_LIST_KEY = 'counsellor_phone'

async function fallbackPhones(clientId: string): Promise<Record<string, string>> {
  try {
    const rows = await db(clientId)<{ value: string }>(
      `SELECT value FROM client_option_items WHERE client_id = $1 AND list_key = $2`,
      [clientId, PHONE_LIST_KEY]
    )
    const out: Record<string, string> = {}
    for (const row of rows) {
      // Stored as "<user id>:<number>".
      const at = (row.value || '').indexOf(':')
      if (at > 0) out[row.value.slice(0, at)] = row.value.slice(at + 1)
    }
    return out
  } catch {
    return {}
  }
}

// Saves (or, with a blank number, clears) one counsellor's alert number.
export async function setCounsellorPhone(clientId: string, userId: string, raw: string | null | undefined) {
  const phone = (raw || '').trim()
  if (await ensurePhoneColumn(clientId)) {
    await db(clientId)('UPDATE users SET phone = $1 WHERE id = $2', [phone || null, userId])
    return
  }
  await db(clientId)(`DELETE FROM client_option_items WHERE client_id = $1 AND list_key = $2 AND value LIKE $3`, [
    clientId,
    PHONE_LIST_KEY,
    `${userId}:%`,
  ])
  if (!phone) return
  await db(clientId)(
    `INSERT INTO client_option_items (client_id, list_key, value, is_active)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (client_id, list_key, value) DO NOTHING`,
    [clientId, PHONE_LIST_KEY, `${userId}:${phone}`]
  )
}

// Reads them back for a list of counsellors, from whichever place they are
// stored in this schema.
export async function counsellorPhones(clientId: string): Promise<Record<string, string>> {
  if (await ensurePhoneColumn(clientId)) {
    try {
      const rows = await db(clientId)<{ id: string; phone: string | null }>(
        `SELECT id, phone FROM users WHERE client_id = $1 AND phone IS NOT NULL AND phone <> ''`,
        [clientId]
      )
      const out: Record<string, string> = {}
      for (const row of rows) out[row.id] = row.phone as string
      return out
    } catch {
      return {}
    }
  }
  return fallbackPhones(clientId)
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
  // Without the column, numbers live in client_option_items — look them up
  // there and pair them with the counsellor rows.
  if (!(await ensurePhoneColumn(clientId))) {
    const phones = await fallbackPhones(clientId)
    const ids = assignedCounsellorId ? [assignedCounsellorId] : Object.keys(phones)
    const wanted = ids.filter((id) => phones[id])
    if (wanted.length === 0) return []
    try {
      const rows = await db(clientId)<{ id: string; full_name: string | null }>(
        `SELECT id, full_name FROM users
         WHERE id = ANY($1::uuid[]) AND client_id = $2 AND COALESCE(is_active, true)`,
        [wanted, clientId]
      )
      return rows.map((r) => ({ id: r.id, full_name: r.full_name, phone: phones[r.id] }))
    } catch {
      return []
    }
  }
  try {
    if (assignedCounsellorId) {
      return await db(clientId)<Recipient>(
        `SELECT id, full_name, phone FROM users
         WHERE id = $1 AND phone IS NOT NULL AND phone <> '' AND COALESCE(is_active, true)`,
        [assignedCounsellorId]
      )
    }
    return await db(clientId)<Recipient>(
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
    const [tpl] = await db(clientId)<{ name: string; language: string }>(
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
