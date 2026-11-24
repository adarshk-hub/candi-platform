// path: lib/welcomeMessage.ts
import { queryAsClient, runAsClient } from './db'
import { startSequence } from './waSequenceEngine'
import { isLocalOcto } from './localOcto'
import { sendLocalOctoStageSms } from './msg91Sms'

export type WelcomeStatus = 'pending' | 'sent' | 'skipped'

// The welcome message always sends on its own now — the setting that used
// to gate it has been removed from Settings, so reading the column would
// mean behaviour nobody can see or change.
//
// The clients.wa_welcome_confirm column is deliberately left in place
// rather than dropped: it costs nothing, and reinstating the control later
// is then a UI change rather than another migration.
export async function requiresWelcomeConfirmation(_clientId: string): Promise<boolean> {
  return false
}

async function setStatus(clientId: string, leadId: string, status: WelcomeStatus): Promise<void> {
  try {
    await queryAsClient(clientId, 'UPDATE leads SET welcome_message_status = $1 WHERE id = $2', [status, leadId])
  } catch {
    // Column missing — nothing to record, and the send decision above has
    // already been made either way.
  }
}

// The single entry point every intake path now uses in place of calling
// startSequence() directly. Either the sequence starts immediately (as
// before), or the lead is parked as 'pending' and a prompt appears at the
// top of the lead for someone to decide.
export async function startWelcomeOrAsk(
  clientId: string,
  leadId: string
): Promise<{ started: boolean; pending: boolean }> {
  if (await requiresWelcomeConfirmation(clientId)) {
    await setStatus(clientId, leadId, 'pending')
    await queryAsClient(
      clientId,
      `INSERT INTO activity_log (lead_id, activity_type, title, description)
       VALUES ($1, 'system', 'Welcome Message Held', $2)`,
      [leadId, 'Waiting for someone to confirm before the WhatsApp welcome is sent.']
    ).catch(() => {})
    return { started: false, pending: true }
  }

  // runAsClient: this runs from webhooks (no session) and from waitUntil
  // after the response — startSequence and everything it calls use query().
  const result = await runAsClient(clientId, () => startSequence(leadId))
  if (!result.ok) {
    console.error(`[welcome] could not start sequence for lead ${leadId}: ${result.error}`)
    await queryAsClient(
      clientId,
      `INSERT INTO activity_log (lead_id, activity_type, title, description)
       VALUES ($1, 'system', 'Welcome Message Not Sent', $2)`,
      [leadId, `WhatsApp welcome could not start: ${result.error}`]
    ).catch(() => {})
  }
  await setStatus(clientId, leadId, 'sent')

  // Local Octo only: the "Lead" SMS for new leads from Meta, the website and
  // WhatsApp. (Leads added by hand never reach here.)
  if (isLocalOcto(clientId)) {
    const [lead] = await queryAsClient(clientId, 'SELECT * FROM leads WHERE id = $1', [leadId]).catch(() => [])
    if (lead) await sendLocalOctoStageSms({ clientId, lead, stage: 'new_lead' })
  }

  return { started: result.ok, pending: false }
}
