// path: lib/stageEmail.ts
// Stage emails — Local Octo only.
//
// Each stage can have an email (subject + body written in Settings > Stage
// Emails, no approval needed) and a mode, stored in clients.email_stage_config:
//   { [stageKey]: { mode: 'auto' | 'manual' | 'off', subject, body } }
//   auto   — sent the moment the lead reaches the stage (Lead: when it comes in)
//   manual — the CRM asks before sending (EmailStagePrompt)
//   off    — never sent automatically; can still be sent from the lead's Email tab
// Sends go through the school's own mailbox (Settings > School Email) and are
// logged in email_messages, which the lead's Email tab and the Sent Emails
// page read.
import { queryAsClient } from './db'
import { isLocalOcto } from './localOcto'
import { sendEmail } from './email'
import { renderStageEmail } from './stageEmailRender'

export type EmailMode = 'auto' | 'manual' | 'off'

export interface StageEmailEntry {
  mode: EmailMode
  subject: string
  body: string
}

export type StageEmailConfig = Record<string, StageEmailEntry>

export async function getStageEmailConfig(clientId: string): Promise<StageEmailConfig> {
  try {
    const [row] = await queryAsClient<{ email_stage_config: StageEmailConfig | null }>(
      clientId,
      'SELECT email_stage_config FROM clients WHERE id = $1',
      [clientId]
    )
    return row?.email_stage_config || {}
  } catch {
    return {} // column not added yet — nothing is configured
  }
}

// Variable values for one lead.
export async function stageEmailVars(clientId: string, lead: any): Promise<Record<string, string>> {
  const [client] = await queryAsClient<{ name: string }>(clientId, 'SELECT name FROM clients WHERE id = $1', [
    clientId,
  ]).catch(() => [] as any[])
  const [booking] = await queryAsClient<{ d: string; t: string }>(
    clientId,
    `SELECT to_char(event_date, 'FMDD Mon YYYY') AS d, to_char(event_time, 'FMHH12:MI AM') AS t
     FROM events
     WHERE lead_id = $1 AND status IN ('scheduled', 'confirmed') AND event_date IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [lead.id]
  ).catch(() => [] as any[])
  return {
    name: lead.full_name || '',
    company: lead.child_name || lead.company_name || '',
    email: lead.email || '',
    phone: lead.whatsapp_number || '',
    city: lead.location || '',
    date: booking?.d || '',
    time: booking?.t || '',
    school: client?.name || '',
  }
}

async function logActivity(clientId: string, leadId: string, title: string, description: string, actorId?: string | null) {
  await queryAsClient(
    clientId,
    `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id) VALUES ($1, 'system', $2, $3, $4)`,
    [leadId, title, description, actorId || null]
  ).catch(() => {})
}

export interface StageEmailResult {
  ok: boolean
  skipped?: boolean
  error?: string
}

// Sends one stage's email to one Local Octo lead. Never throws.
//   trigger 'auto'   — stage change / new lead; only if the stage is Automatic
//   trigger 'manual' — Send clicked in the stage prompt; unless Off
//   trigger 'direct' — sent from the lead's Email tab (any configured stage)
// subject/body override the saved template (the Email tab lets you edit
// before sending); otherwise the saved template is filled from the lead.
export async function sendLocalOctoStageEmail(params: {
  clientId: string
  lead: any
  stage: string
  trigger: 'auto' | 'manual' | 'direct'
  sentBy?: string | null
  subject?: string
  body?: string
}): Promise<StageEmailResult> {
  const { clientId, lead, stage, trigger, sentBy } = params
  try {
    if (!isLocalOcto(clientId)) return { ok: false, skipped: true }
    const entry = (await getStageEmailConfig(clientId))[stage]
    if (!entry || !entry.subject?.trim() || !entry.body?.trim()) {
      return { ok: false, skipped: true, error: 'No email is written for this stage.' }
    }
    if (trigger === 'auto' && entry.mode !== 'auto') return { ok: false, skipped: true }
    if (trigger === 'manual' && entry.mode === 'off') return { ok: false, skipped: true }

    if (!lead.email) {
      await logActivity(clientId, lead.id, 'Email Not Sent', 'The lead has no email address.', sentBy)
      return { ok: false, error: 'This lead has no email address.' }
    }

    const vars = await stageEmailVars(clientId, lead)
    const subject = (params.subject ?? renderStageEmail(entry.subject, vars)).trim()
    const body = (params.body ?? renderStageEmail(entry.body, vars)).trim()

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
      // Unlike the dev stub elsewhere, a stage email with no mailbox set up
      // is reported as not sent rather than logged as delivered.
      { to: lead.email, subject, body, failIfUnconfigured: true }
    )

    await queryAsClient(
      clientId,
      `INSERT INTO email_messages (lead_id, template_key, subject, body, to_email, status, error, sent_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [lead.id, `stage:${stage}`, subject, body, lead.email, result.ok ? 'sent' : 'failed', result.error || null, sentBy || null]
    ).catch((err) => console.error('[stage-email] could not record email', err))

    await logActivity(
      clientId,
      lead.id,
      result.ok ? 'Email Sent' : 'Email Failed',
      result.ok ? `"${subject}" sent to ${lead.email}.` : `"${subject}" to ${lead.email} failed: ${result.error}`,
      sentBy
    )
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  } catch (err: any) {
    console.error('[stage-email] failed', err)
    return { ok: false, error: err?.message || 'Email failed' }
  }
}
