// path: lib/bookingNotify.ts
// Booking notifications — Local Octo only.
//
// When a call is booked the lead can get a WhatsApp, an SMS and an email:
//   on_booking — right after the call is booked (or rescheduled)
//   before_1h  — 1 hour before the call
//   before_10m — 10 minutes before the call
// Every template and mode lives in clients.booking_notify_config (Settings >
// Booking Reminders), so all of it can be changed without code:
//   { [kind]: { whatsapp: { mode, template, params[] },
//               sms:      { mode, name, templateId, text },
//               email:    { mode, subject, body } } }
//   mode: 'auto' sends by itself; 'manual' (on_booking only) asks first in the
//   Bookings tab; 'off' never sends.
// Each send is recorded in booking_notifications, so a reminder goes out once
// per booking and channel. The 1h / 10m reminders are sent by
// /api/cron/booking-reminders, which an external scheduler calls every few
// minutes.
import { queryAsClient } from './db'
import { isLocalOcto, LOCAL_OCTO_CLIENT_ID } from './localOcto'
import { sendTemplateMessage } from './metaWhatsapp'
import { sendEmail } from './email'
import { sendMsg91TemplateToLead } from './msg91Sms'
import { renderStageEmail } from './stageEmailRender'
import { bodyComponentFor, extractVariableTokens, renderBody } from './templateVariables'

export type NotifyKind = 'on_booking' | 'before_1h' | 'before_10m'
export type NotifyChannel = 'whatsapp' | 'sms' | 'email'
export type NotifyMode = 'auto' | 'manual' | 'off'

export const NOTIFY_KINDS: NotifyKind[] = ['on_booking', 'before_1h', 'before_10m']
export const NOTIFY_CHANNELS: NotifyChannel[] = ['whatsapp', 'sms', 'email']

export interface NotifyChannelConfig {
  mode: NotifyMode
  // whatsapp
  template?: string
  params?: string[]
  // sms
  name?: string
  templateId?: string
  text?: string
  // email
  subject?: string
  body?: string
}

export type BookingNotifyConfig = Partial<Record<NotifyKind, Partial<Record<NotifyChannel, NotifyChannelConfig>>>>

// The booking details a template can use.
export const BOOKING_VARIABLES: { key: string; label: string }[] = [
  { key: 'name', label: 'Full name' },
  { key: 'company', label: 'Company name' },
  { key: 'date', label: 'Booking date' },
  { key: 'time', label: 'Booking time' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'city', label: 'City' },
  { key: 'school', label: 'Your business name' },
]

export async function getBookingNotifyConfig(clientId: string): Promise<BookingNotifyConfig> {
  try {
    const [row] = await queryAsClient<{ booking_notify_config: BookingNotifyConfig | null }>(
      clientId,
      'SELECT booking_notify_config FROM clients WHERE id = $1',
      [clientId]
    )
    return row?.booking_notify_config || {}
  } catch {
    return {} // column not added yet
  }
}

interface BookingRow {
  event_id: string
  event_type: string
  lead: any
  vars: Record<string, string>
}

export async function loadBooking(clientId: string, eventId: string): Promise<BookingRow | null> {
  const [row] = await queryAsClient<any>(
    clientId,
    `SELECT e.id AS event_id, e.event_type,
            to_char(e.event_date, 'FMDD Mon YYYY') AS d, to_char(e.event_time, 'FMHH12:MI AM') AS t,
            l.*, c.name AS client_name
     FROM events e
     JOIN leads l ON l.id = e.lead_id
     LEFT JOIN clients c ON c.id = l.client_id
     WHERE e.id = $1`,
    [eventId]
  )
  if (!row) return null
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    lead: row,
    vars: {
      name: row.full_name || '',
      company: row.child_name || row.company_name || '',
      date: row.d || '',
      time: row.t || '',
      phone: row.whatsapp_number || '',
      email: row.email || '',
      city: row.location || '',
      school: row.client_name || '',
    },
  }
}

async function logActivity(clientId: string, leadId: string, title: string, description: string, actorId?: string | null) {
  await queryAsClient(
    clientId,
    `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id) VALUES ($1, 'system', $2, $3, $4)`,
    [leadId, title, description, actorId || null]
  ).catch(() => {})
}

async function recordNotification(
  clientId: string,
  eventId: string,
  kind: NotifyKind,
  channel: NotifyChannel,
  ok: boolean,
  error?: string
) {
  await queryAsClient(
    clientId,
    `INSERT INTO booking_notifications (event_id, kind, channel, status, error) VALUES ($1, $2, $3, $4, $5)`,
    [eventId, kind, channel, ok ? 'sent' : 'failed', error || null]
  ).catch((err) => console.error('[booking-notify] could not record', err))
}

// The WhatsApp template's approved body, plus its variable placeholders.
async function loadWaTemplate(clientId: string, name: string) {
  const [t] = await queryAsClient<{ name: string; language: string; components: any }>(
    clientId,
    `SELECT name, language, components FROM wa_templates WHERE client_id = $1 AND name = $2 AND status = 'approved'`,
    [clientId, name]
  )
  if (!t) return null
  const components = Array.isArray(t.components) ? t.components : []
  const body = components.find((c: any) => String(c.type || '').toUpperCase() === 'BODY')?.text || ''
  return { name: t.name, language: t.language || 'en', body, tokens: extractVariableTokens(body) }
}

// What a channel's message will say for this booking — used by the
// "Ask before sending" prompt to show the text before it goes.
export async function previewChannel(
  clientId: string,
  booking: BookingRow,
  cfg: NotifyChannelConfig,
  channel: NotifyChannel
): Promise<string> {
  if (channel === 'whatsapp') {
    const t = cfg.template ? await loadWaTemplate(clientId, cfg.template) : null
    if (!t) return `WhatsApp template "${cfg.template || ''}" is not approved.`
    const values = t.tokens.map((_, i) => booking.vars[cfg.params?.[i] || ''] || '')
    return renderBody(t.body, values, t.tokens)
  }
  if (channel === 'sms') return String(cfg.text || '').replace(/##(\w+)##/g, (_, k) => booking.vars[k] || '')
  return `${renderStageEmail(cfg.subject || '', booking.vars)}\n\n${renderStageEmail(cfg.body || '', booking.vars)}`
}

async function sendOne(
  clientId: string,
  booking: BookingRow,
  kind: NotifyKind,
  channel: NotifyChannel,
  cfg: NotifyChannelConfig,
  sentBy?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const lead = booking.lead
  if (channel === 'whatsapp') {
    const t = cfg.template ? await loadWaTemplate(clientId, cfg.template) : null
    if (!t) {
      await logActivity(clientId, lead.id, 'WhatsApp Not Sent', `Booking message: template "${cfg.template || ''}" is not approved.`, sentBy)
      return { ok: false, error: 'template not approved' }
    }
    const values = t.tokens.map((_, i) => booking.vars[cfg.params?.[i] || ''] || '')
    if (values.some((v) => !v)) {
      await logActivity(clientId, lead.id, 'WhatsApp Not Sent', `${t.name}: a variable has no value for this lead.`, sentBy)
      return { ok: false, error: 'missing variable value' }
    }
    const rendered = renderBody(t.body, values, t.tokens)
    const [row] = await queryAsClient<any>(
      clientId,
      `INSERT INTO whatsapp_messages (lead_id, direction, message_type, body, template_name, status, sent_by)
       VALUES ($1, 'outbound', 'template', $2, $3, 'queued', $4) RETURNING id`,
      [lead.id, rendered, t.name, sentBy || null]
    )
    const result = await sendTemplateMessage({
      clientId,
      to: lead.whatsapp_number,
      templateName: t.name,
      languageCode: t.language,
      components: bodyComponentFor(t.tokens, values) || [],
    })
    if (row) {
      await queryAsClient(clientId, `UPDATE whatsapp_messages SET status = $1, wamid = $2, external_message_id = $2 WHERE id = $3`, [
        result.ok ? 'sent' : 'failed',
        result.wamid || null,
        row.id,
      ]).catch(() => {})
    }
    if (!result.ok) await logActivity(clientId, lead.id, 'WhatsApp Failed', `${t.name}: ${result.error}`, sentBy)
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  }

  if (channel === 'sms') {
    if (!cfg.templateId || !cfg.text) return { ok: false, error: 'SMS template not set' }
    return sendMsg91TemplateToLead({
      clientId,
      lead,
      template: { name: cfg.name || 'booking_sms', templateId: cfg.templateId, text: cfg.text },
      values: booking.vars,
      trigger: 'booking',
      stageKey: `booking:${kind}`,
      sentBy,
    })
  }

  // email
  if (!lead.email) return { ok: false, error: 'the lead has no email address' }
  if (!cfg.subject?.trim() || !cfg.body?.trim()) return { ok: false, error: 'email not written' }
  const subject = renderStageEmail(cfg.subject, booking.vars).trim()
  const body = renderStageEmail(cfg.body, booking.vars).trim()
  const [client] = await queryAsClient<any>(
    clientId,
    'SELECT school_email, email_from_name, smtp_host, smtp_port, smtp_user, smtp_pass FROM clients WHERE id = $1',
    [clientId]
  )
  const result = await sendEmail(
    {
      host: client?.smtp_host || null,
      port: client?.smtp_port || null,
      user: client?.smtp_user || null,
      pass: client?.smtp_pass || null,
      fromEmail: client?.school_email || null,
      fromName: client?.email_from_name || null,
    },
    { to: lead.email, subject, body, failIfUnconfigured: true }
  )
  await queryAsClient(
    clientId,
    `INSERT INTO email_messages (lead_id, template_key, subject, body, to_email, status, error, sent_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [lead.id, `booking:${kind}`, subject, body, lead.email, result.ok ? 'sent' : 'failed', result.error || null, sentBy || null]
  ).catch(() => {})
  await logActivity(
    clientId,
    lead.id,
    result.ok ? 'Email Sent' : 'Email Failed',
    result.ok ? `"${subject}" sent to ${lead.email}.` : `"${subject}" to ${lead.email} failed: ${result.error}`,
    sentBy
  )
  return result.ok ? { ok: true } : { ok: false, error: result.error }
}

// Sends a booking's notification for one kind.
//   trigger 'auto'   — only channels set to Automatic
//   trigger 'manual' — the channels picked in the "Ask before sending" prompt
// Never throws.
export async function sendBookingNotifications(params: {
  clientId: string
  eventId: string
  kind: NotifyKind
  trigger: 'auto' | 'manual'
  channels?: NotifyChannel[]
  sentBy?: string | null
}): Promise<Record<string, { ok: boolean; error?: string }>> {
  const { clientId, eventId, kind, trigger, sentBy } = params
  const out: Record<string, { ok: boolean; error?: string }> = {}
  try {
    if (!isLocalOcto(clientId)) return out
    const config = (await getBookingNotifyConfig(clientId))[kind] || {}
    const booking = await loadBooking(clientId, eventId)
    if (!booking || booking.event_type !== 'call_booked') return out

    for (const channel of NOTIFY_CHANNELS) {
      const cfg = config[channel]
      if (!cfg) continue
      const wanted =
        trigger === 'auto' ? cfg.mode === 'auto' : cfg.mode !== 'off' && (params.channels || []).includes(channel)
      if (!wanted) continue
      const res = await sendOne(clientId, booking, kind, channel, cfg, sentBy).catch((err: any) => ({
        ok: false,
        error: err?.message || 'failed',
      }))
      out[channel] = res
      await recordNotification(clientId, eventId, kind, channel, res.ok, res.error)
    }
  } catch (err) {
    console.error('[booking-notify] failed', err)
  }
  return out
}

// A rescheduled call should be reminded about again at its new time.
export async function clearBookingReminders(clientId: string, eventId: string) {
  await queryAsClient(
    clientId,
    `DELETE FROM booking_notifications WHERE event_id = $1 AND kind IN ('before_1h', 'before_10m')`,
    [eventId]
  ).catch(() => {})
}

// Called by /api/cron/booking-reminders every few minutes. Finds Local Octo
// calls whose 1-hour or 10-minute mark has arrived and sends each reminder
// once. A call booked too close to the start (e.g. 40 minutes ahead) skips
// the "starts in 1 hour" reminder rather than sending a wrong message.
export async function sendDueBookingReminders(): Promise<{ sent: number }> {
  const clientId = LOCAL_OCTO_CLIENT_ID
  const config = await getBookingNotifyConfig(clientId)
  let sent = 0
  const windows: { kind: NotifyKind; leadMin: number; minLeft: number }[] = [
    { kind: 'before_1h', leadMin: 60, minLeft: 10 },
    { kind: 'before_10m', leadMin: 10, minLeft: 0 },
  ]
  for (const w of windows) {
    const cfg = config[w.kind] || {}
    if (!NOTIFY_CHANNELS.some((c) => cfg[c]?.mode === 'auto')) continue
    // Call times are stored as Indian local time.
    const due = await queryAsClient<{ id: string }>(
      clientId,
      `SELECT e.id FROM events e
       WHERE e.event_type = 'call_booked'
         AND e.status IN ('scheduled', 'confirmed')
         AND e.event_date IS NOT NULL AND e.event_time IS NOT NULL
         AND ((e.event_date + e.event_time) AT TIME ZONE 'Asia/Kolkata') - now() <= make_interval(mins => $1)
         AND ((e.event_date + e.event_time) AT TIME ZONE 'Asia/Kolkata') - now() > make_interval(mins => $2)
         AND e.created_at <= ((e.event_date + e.event_time) AT TIME ZONE 'Asia/Kolkata') - make_interval(mins => $1)
         AND NOT EXISTS (SELECT 1 FROM booking_notifications n WHERE n.event_id = e.id AND n.kind = $3)`,
      [w.leadMin, w.minLeft, w.kind]
    ).catch((err) => {
      console.error('[booking-notify] due query failed', err)
      return [] as { id: string }[]
    })
    for (const e of due) {
      const res = await sendBookingNotifications({ clientId, eventId: e.id, kind: w.kind, trigger: 'auto' })
      sent += Object.values(res).filter((r) => r.ok).length
    }
  }
  return { sent }
}
