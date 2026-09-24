// path: lib/assignPermission.ts
import { query } from '@/lib/db'
import { AGENCY_ROLES, SessionUser } from '@/lib/auth'

// Whether a counsellor at this institute may hand a lead to a colleague.
// Off by default: reassignment has always been an admin action, so an
// institute that hasn't opted in keeps exactly the behaviour it had.
//
// Stored per institute on clients.counsellor_can_assign. Each school is its
// own Postgres schema, so the column is added on demand rather than left to
// a migration someone has to remember to run five times.
let columnReady: Map<string, boolean> = new Map()

async function ensureColumn(): Promise<boolean> {
  try {
    const [row] = await query<{ db: string; present: boolean }>(
      `SELECT current_schema() AS db,
              EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'clients' AND column_name = 'counsellor_can_assign'
              ) AS present`
    )
    const key = row?.db || 'unknown'
    if (columnReady.get(key)) return true
    if (row?.present) {
      columnReady.set(key, true)
      return true
    }
    await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS counsellor_can_assign BOOLEAN DEFAULT false`)
    columnReady.set(key, true)
    return true
  } catch (err) {
    console.error('[assignPermission] could not add clients.counsellor_can_assign:', err)
    return false
  }
}

export async function counsellorCanAssign(clientId: string): Promise<boolean> {
  if (!(await ensureColumn())) return false
  try {
    const [row] = await query<{ counsellor_can_assign: boolean | null }>(
      'SELECT counsellor_can_assign FROM clients WHERE id = $1',
      [clientId]
    )
    return row?.counsellor_can_assign === true
  } catch {
    return false
  }
}

export async function setCounsellorCanAssign(clientId: string, value: boolean): Promise<boolean> {
  if (!(await ensureColumn())) return false
  await query('UPDATE clients SET counsellor_can_assign = $1 WHERE id = $2', [value, clientId])
  return true
}

// The one answer used everywhere: the leads list, the Activity page, the
// lead panel and the bulk bar all ask this, so they can never disagree
// about who is allowed to reassign.
export async function canAssignLeads(session: SessionUser | null, clientId?: string | null): Promise<boolean> {
  if (!session) return false
  if (AGENCY_ROLES.includes(session.role) || session.role === 'client_admin') return true
  if (session.role !== 'client_counsellor') return false
  const scope = clientId || session.clientId
  if (!scope) return false
  return counsellorCanAssign(scope)
}
