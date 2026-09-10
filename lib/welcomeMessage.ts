// path: lib/welcomeMessage.ts
import { queryAsClient } from './db'
import { startSequence } from './waSequenceEngine'

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

  const result = await startSequence(leadId)
  if (!result.ok) {
    console.error(`[welcome] could not start sequence for lead ${leadId}: ${result.error}`)
  }
  await setStatus(clientId, leadId, 'sent')
  return { started: result.ok, pending: false }
}
