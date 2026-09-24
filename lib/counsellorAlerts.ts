// path: lib/counsellorAlerts.ts
import { query } from '@/lib/db'
import { sendTemplateMessage, sendTextMessage } from '@/lib/metaWhatsapp'

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
async function deliver(clientId: string, to: string, text: string) {
  try {
    const [tpl] = await query<{ name: string; language: string }>(
      `SELECT name, language FROM wa_templates
       WHERE client_id = $1 AND status = 'approved' AND name ILIKE '%counsellor_alert%'
       ORDER BY submitted_at DESC LIMIT 1`,
      [clientId]
    )
    if (tpl) {
      const res = await sendTemplateMessage({
        clientId,
        to,
        templateName: tpl.name,
        languageCode: tpl.language || 'en',
        components: [{ type: 'body', parameters: [{ type: 'text', text }] }],
      })
      if (res.ok) return
    }
    await sendTextMessage({ clientId, to, body: text })
  } catch (err) {
    console.error('[counsellorAlerts] send failed:', err)
  }
}

async function notify(clientId: string, assignedCounsellorId: string | null, text: string) {
  const people = await recipientsFor(clientId, assignedCounsellorId)
  for (const person of people) {
    await deliver(clientId, person.phone, text)
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
  const name = (params.leadName || '').trim() || 'A new enquiry'
  const bits = [`New lead: ${name}`]
  if (params.phone) bits.push(params.phone)
  if (params.source) bits.push(`via ${params.source}`)
  await notify(params.clientId, params.assignedCounsellorId || null, `${bits.join(' · ')}. Open Candi Connect to follow up.`)
}

// Fired when a call or visit is booked from the lead panel.
export async function notifyBooking(params: {
  clientId: string
  assignedCounsellorId?: string | null
  leadName?: string | null
  kind: 'call' | 'visit'
  when?: string | null
}) {
  const name = (params.leadName || '').trim() || 'A lead'
  const what = params.kind === 'visit' ? 'Visit booked' : 'Call booked'
  const when = params.when ? ` for ${params.when}` : ''
  await notify(params.clientId, params.assignedCounsellorId || null, `${what}${when}: ${name}. Open Candi Connect for the details.`)
}
