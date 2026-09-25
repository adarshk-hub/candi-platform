// path: lib/emailBroadcastRequest.ts
import { query } from '@/lib/db'

// A client admin can't set up SMTP themselves — the agency does that. So
// instead of showing them a mail server form, they tick a box asking for
// email broadcasts, and the agency sees the request on the School Email
// screen. Stored per institute; the column is added on demand, since each
// school is its own schema.
const ready = new Map<string, boolean>()

async function ensureColumn(): Promise<boolean> {
  try {
    const [row] = await query<{ schema: string; present: boolean }>(
      `SELECT current_schema() AS schema,
              EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'clients' AND column_name = 'email_broadcast_requested'
              ) AS present`
    )
    const key = row?.schema || 'unknown'
    if (ready.get(key)) return true
    if (row?.present) {
      ready.set(key, true)
      return true
    }
    await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_broadcast_requested BOOLEAN DEFAULT false`)
    ready.set(key, true)
    return true
  } catch (err) {
    console.error('[emailBroadcastRequest] could not add clients.email_broadcast_requested:', err)
    return false
  }
}

export async function getEmailBroadcastRequest(clientId: string): Promise<boolean> {
  if (!(await ensureColumn())) return false
  try {
    const [row] = await query<{ email_broadcast_requested: boolean | null }>(
      'SELECT email_broadcast_requested FROM clients WHERE id = $1',
      [clientId]
    )
    return row?.email_broadcast_requested === true
  } catch {
    return false
  }
}

export async function setEmailBroadcastRequest(clientId: string, value: boolean): Promise<boolean> {
  if (!(await ensureColumn())) return false
  await query('UPDATE clients SET email_broadcast_requested = $1 WHERE id = $2', [value, clientId])
  return true
}
