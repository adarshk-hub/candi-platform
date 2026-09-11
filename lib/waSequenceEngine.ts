// path: lib/waSequenceEngine.ts
import { query, queryAsClient, centralQuery } from './db'
import { sendTemplateMessage, getTemplateBodyVariableCount } from './metaWhatsapp'
import { NURTURE_STEPS } from './nurtureSteps'

interface SequenceStep {
  day: number
  templateName: string
  languageCode: string
}

// Per-client template overrides live in wa_sequence_templates. Clients that
// haven't configured their own templates yet fall back to the shared
// NURTURE_STEPS defaults (nurture_day0 / nurture_day2 / ...), same names
// the old Aisensy path used, so nothing breaks for clients mid-migration.
// Steps this engine is allowed to send on a schedule.
//
// Anything ticked "Ask first" in Settings is excluded, and so is anything
// pinned to a stage. Both of those are triggered by a lead moving stage (see
// StageMessagePrompt), and a step that is both scheduled here and triggered
// there goes out twice — which is exactly what was happening with Day 2:
// ticked "Ask first", ignored by this query, sent anyway on time.
//
// The tick is a setting about *when* a message is sent, so the code that
// sends on a timer has to read it too. It previously only governed the
// stage-change path, which made the tick look broken rather than partial.
async function getStepsForClient(clientId: string): Promise<SequenceStep[]> {
  let rows: { day_number: number; template_name: string; language_code: string }[] = []
  try {
    rows = await query(
      `SELECT day_number, template_name, language_code
       FROM wa_sequence_templates
       WHERE client_id = $1
         AND COALESCE(require_confirmation, false) = false
         AND COALESCE(stage_key, '') = ''
       ORDER BY day_number ASC`,
      [clientId]
    )
  } catch (err: any) {
    // Pre-migration database — neither column exists yet, so fall back to
    // the old behaviour rather than sending nothing at all.
    if (err?.code !== '42703') throw err
    rows = await query(
      'SELECT day_number, template_name, language_code FROM wa_sequence_templates WHERE client_id = $1 ORDER BY day_number ASC',
      [clientId]
    )
  }

  if (rows.length > 0) {
    return rows.map((r) => ({ day: r.day_number, templateName: r.template_name, languageCode: r.language_code }))
  }
  return NURTURE_STEPS.map((s) => ({ day: s.day, templateName: s.templateName, languageCode: 'en' }))
}

// Creates a wa_sequences row, schedules all remaining days as
// wa_sequence_messages, sends Day 0 immediately, and points
// leads.wa_sequence_id at the new sequence. Safe to call even if a lead
// already has a completed/cancelled sequence — a new one is started
// alongside it (the lead's wa_sequence_id simply moves to the new one).
export async function startSequence(leadId: string): Promise<{ ok: boolean; sequenceId?: string; error?: string }> {
  const lead = (await query('SELECT * FROM leads WHERE id = $1', [leadId]))[0]
  if (!lead) return { ok: false, error: 'Lead not found' }

  const existingActive = (
    await query('SELECT id FROM wa_sequences WHERE lead_id = $1 AND status = $2', [leadId, 'active'])
  )[0]
  if (existingActive) return { ok: false, error: 'Lead already has an active sequence' }

  const steps = await getStepsForClient(lead.client_id)
  if (steps.length === 0) return { ok: false, error: 'No sequence templates configured for this client' }

  const sequence = (
    await query(
      `INSERT INTO wa_sequences (lead_id, client_id, phone_number, status)
       VALUES ($1, $2, $3, 'active') RETURNING *`,
      [leadId, lead.client_id, lead.whatsapp_number]
    )
  )[0]

  await query('UPDATE leads SET wa_sequence_id = $1 WHERE id = $2', [sequence.id, leadId])

  const now = new Date()
  for (const step of steps) {
    const scheduledFor = new Date(now.getTime() + step.day * 24 * 60 * 60 * 1000)
    await query(
      `INSERT INTO wa_sequence_messages (sequence_id, day_number, template_name, language_code, scheduled_for, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [sequence.id, step.day, step.templateName, step.languageCode, scheduledFor]
    )
  }

  // Day 0 only — the welcome message.
  //
  // Day 2 used to be sent immediately alongside it, on the reasoning that it
  // would otherwise sit pending for two real days. That made sense while the
  // whole sequence ran on a fixed schedule. It doesn't now: steps after the
  // first fire when a lead's stage changes (see StageMessagePrompt), so
  // sending Day 2 at creation meant a parent got two templates within a
  // second of enquiring — before anyone had spoken to them — and then
  // potentially the same message again when the stage actually moved.
  const day0 = await query(
    `SELECT * FROM wa_sequence_messages WHERE sequence_id = $1 AND day_number = 0`,
    [sequence.id]
  )
  for (const msg of day0) {
    await sendDueMessage(msg)
  }

  return { ok: true, sequenceId: sequence.id }
}

// clientId is supplied by the cron path and omitted by the request path
// (startSequence, which runs inside a logged-in request). query() resolves
// its database from the session and throws when there isn't one, so the
// cron caller has to say which institute it is working on; `q` below picks
// whichever is correct rather than duplicating this function.
async function sendDueMessage(msg: any, clientId?: string): Promise<void> {
  const q = <T = any>(text: string, params?: any[]): Promise<T[]> =>
    clientId ? queryAsClient<T>(clientId, text, params) : query<T>(text, params)

  if (!msg) return

  const sequence = (await q('SELECT * FROM wa_sequences WHERE id = $1', [msg.sequence_id]))[0]
  if (!sequence || sequence.status !== 'active') {
    await q(`UPDATE wa_sequence_messages SET status = 'skipped' WHERE id = $1`, [msg.id])
    return
  }

  const lead = (await q('SELECT * FROM leads WHERE id = $1', [sequence.lead_id]))[0]

  // A template's approved body might have zero variables (a fully static
  // welcome/notice line) or several — sending a fixed one-parameter guess
  // gets rejected outright by Meta (#132000) the moment it doesn't match.
  // Only the first variable is auto-filled (the lead's name, matching this
  // app's convention everywhere else a template is sent); anything beyond
  // that isn't something this scheduled engine has data for, so it's left
  // blank rather than guessed.
  const variableCount = await getTemplateBodyVariableCount(sequence.client_id, msg.template_name)
  const bodyComponents =
    variableCount > 0
      ? [
          {
            type: 'body',
            parameters: Array.from({ length: variableCount }, (_, i) => ({
              type: 'text',
              text: i === 0 ? lead?.full_name || 'there' : '',
            })),
          },
        ]
      : []

  let result: { ok: boolean; wamid?: string; error?: string }
  try {
    result = await sendTemplateMessage({
      clientId: sequence.client_id,
      to: sequence.phone_number,
      templateName: msg.template_name,
      languageCode: msg.language_code,
      components: bodyComponents,
    })
  } catch (err: any) {
    // A row already claimed as 'processing' must not get stuck there if
    // the send call throws — mark it failed so it's visible and retryable
    // rather than silently vanishing from the pending queue forever.
    result = { ok: false, error: err?.message || 'Unexpected error sending template' }
  }

  await q(
    `UPDATE wa_sequence_messages
     SET status = $1, wamid = $2, sent_at = now(), error_text = $3
     WHERE id = $4`,
    [result.ok ? 'sent' : 'failed', result.wamid || null, result.error || null, msg.id]
  )

  await q(
    `INSERT INTO whatsapp_messages
       (lead_id, direction, message_type, body, template_name, status, wamid, sequence_id, sequence_day)
     VALUES ($1, 'outbound', 'template', $2, $3, $4, $5, $6, $7)`,
    [
      sequence.lead_id,
      `[Day ${msg.day_number}] ${msg.template_name} template ${result.ok ? 'sent' : `failed to send: ${result.error || 'unknown error'}`}.`,
      msg.template_name,
      result.ok ? 'sent' : 'failed',
      result.wamid || null,
      sequence.id,
      msg.day_number,
    ]
  )

  await q(
    `INSERT INTO activity_log (lead_id, activity_type, title, description)
     VALUES ($1, 'system', 'Nurture Sequence', $2)`,
    [
      sequence.lead_id,
      `Day ${msg.day_number} (${msg.template_name}) ${result.ok ? 'sent' : 'failed: ' + result.error} via Meta WhatsApp API.`,
    ]
  )

  await q(
    `UPDATE leads SET nurture_day = $1, nurture_started_at = COALESCE(nurture_started_at, now()) WHERE id = $2`,
    [msg.day_number, sequence.lead_id]
  )

  // Last step in the sequence — mark the whole sequence completed.
  const remaining = await q(
    `SELECT id FROM wa_sequence_messages WHERE sequence_id = $1 AND status = 'pending'`,
    [sequence.id]
  )
  if (remaining.length === 0) {
    await q(`UPDATE wa_sequences SET status = 'completed' WHERE id = $1`, [sequence.id])
  }
}

// Polled every ~60s by app/api/cron/wa-sequence-advance.
//
// IMPORTANT: `query()` runs through the pool with no explicit transaction,
// so a bare `SELECT ... FOR UPDATE SKIP LOCKED` on its own does nothing
// useful — Postgres commits (and releases the row lock) the instant that
// single SELECT statement finishes, well before we get around to sending
// the message and marking it 'sent'. Two overlapping cron invocations
// could both select the same due row and both send it.
//
// Fix: claim rows with a single atomic UPDATE ... WHERE id IN (SELECT ...
// FOR UPDATE SKIP LOCKED) statement. The SELECT's lock and the UPDATE that
// consumes it happen inside the *same* statement/implicit-transaction, so
// the row is flipped to 'processing' before the lock is ever released —
// no other concurrent invocation can grab it in between.
// Multi-tenant entry point for /api/cron/wa-sequence-advance. Each
// institute has its own database, so due messages are claimed per
// institute; the institute list itself is central-registry data.
// Previously this called query(), which resolves its database from the
// logged-in session — a cron request has none, so it threw and the
// endpoint 500'd, meaning no nurture message ever sent for any institute.
export async function advanceDueMessages(): Promise<{ processed: number }> {
  const clients = await centralQuery<{ id: string }>('SELECT id FROM clients')

  let processed = 0
  for (const client of clients) {
    try {
      processed += (await advanceDueMessagesForClient(client.id)).processed
    } catch (err) {
      // One institute's failure must not stop the others.
      console.error(`[wa-sequence] client ${client.id} advance failed:`, err)
    }
  }
  return { processed }
}

export async function advanceDueMessagesForClient(clientId: string): Promise<{ processed: number }> {
  const claimed = await queryAsClient(
    clientId,
    `UPDATE wa_sequence_messages
     SET status = 'processing'
     WHERE id IN (
       SELECT wsm.id
       FROM wa_sequence_messages wsm
       JOIN wa_sequences ws ON ws.id = wsm.sequence_id
       WHERE wsm.status = 'pending'
         AND wsm.scheduled_for <= now()
         AND ws.status = 'active'
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`
  )

  for (const msg of claimed) {
    await sendDueMessage(msg, clientId)
  }

  return { processed: claimed.length }
}

export async function pauseSequence(sequenceId: string, note?: string): Promise<boolean> {
  const rows = await query(
    `UPDATE wa_sequences SET status = 'paused', paused_note = $1 WHERE id = $2 AND status = 'active' RETURNING id, lead_id`,
    [note || null, sequenceId]
  )
  if (rows.length === 0) return false
  await query('UPDATE leads SET nurture_paused = true WHERE id = $1', [rows[0].lead_id])
  return true
}

// Called automatically when a counsellor sends a manual reply from the CRM
// — finds the lead's active sequence (if any) and pauses it, so the
// automated drip doesn't talk over a human conversation already in
// progress.
export async function pauseSequenceForLead(leadId: string, note?: string): Promise<boolean> {
  const active = (
    await query(`SELECT id FROM wa_sequences WHERE lead_id = $1 AND status = 'active'`, [leadId])
  )[0]
  if (!active) return false
  return pauseSequence(active.id, note || `Paused — counsellor active since ${new Date().toISOString()}`)
}

export async function resumeSequence(sequenceId: string): Promise<boolean> {
  const rows = await query(
    `UPDATE wa_sequences SET status = 'active', paused_note = NULL WHERE id = $1 AND status = 'paused' RETURNING id, lead_id`,
    [sequenceId]
  )
  if (rows.length === 0) return false
  await query('UPDATE leads SET nurture_paused = false WHERE id = $1', [rows[0].lead_id])
  return true
}

// Resumes whichever paused sequence belongs to this lead — mirrors
// pauseSequenceForLead so the leads.nurture_paused PATCH toggle (and any
// other lead-scoped caller) doesn't need to know the sequence's own id.
export async function resumeSequenceForLead(leadId: string): Promise<boolean> {
  const paused = (
    await query(`SELECT id FROM wa_sequences WHERE lead_id = $1 AND status = 'paused'`, [leadId])
  )[0]
  if (!paused) return false
  return resumeSequence(paused.id)
}

export async function cancelSequence(sequenceId: string): Promise<boolean> {
  const rows = await query(
    `UPDATE wa_sequences SET status = 'cancelled' WHERE id = $1 AND status IN ('active', 'paused') RETURNING id`,
    [sequenceId]
  )
  return rows.length > 0
}
