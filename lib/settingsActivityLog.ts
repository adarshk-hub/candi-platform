import { query } from './db'
import { SessionUser } from './auth'

// Records one row in settings_activity_log — who changed what section of
// Settings, and a short plain-English description of the change, with a
// timestamp. Called from every settings write route after a successful
// save. Never throws: a logging failure should never block or roll back
// the actual settings change it's describing.
export async function logSettingsActivity(
  clientId: string | null | undefined,
  session: SessionUser | null,
  section: string,
  description: string
): Promise<void> {
  if (!clientId) return
  try {
    await query(
      `INSERT INTO settings_activity_log (client_id, user_id, user_name, section, description)
       VALUES ($1, $2, $3, $4, $5)`,
      [clientId, session?.id || null, session?.fullName || session?.email || 'Unknown user', section, description]
    )
  } catch {
    // Swallow — logging is best-effort and must never fail the real write.
  }
}
