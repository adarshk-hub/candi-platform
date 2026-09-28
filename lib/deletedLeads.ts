// path: lib/deletedLeads.ts
import { queryAsClient } from '@/lib/db'

// A deleted lead used to come back: the hourly Meta backfill re-imports
// anything it finds on the ad account, and a lead deleted in the CRM looks
// to it like a lead it has never seen. So deletions are remembered here, by
// normalised phone number, and intake skips a number on this list.
//
// The table is created on demand — each school is its own schema, and a
// migration per school is a step someone will forget.
const ready = new Map<string, boolean>()

async function ensureTable(clientId: string): Promise<boolean> {
  if (ready.get(clientId)) return true
  try {
    await queryAsClient(
      clientId,
      `CREATE TABLE IF NOT EXISTS deleted_leads (
         client_id UUID NOT NULL,
         normalized_phone VARCHAR NOT NULL,
         deleted_at TIMESTAMP DEFAULT now(),
         PRIMARY KEY (client_id, normalized_phone)
       )`
    )
    ready.set(clientId, true)
    return true
  } catch (err) {
    console.error('[deletedLeads] could not create table:', err)
    return false
  }
}

// Called when leads are deleted in the CRM.
export async function rememberDeletedLeads(clientId: string, normalizedPhones: string[]): Promise<void> {
  const phones = normalizedPhones.filter(Boolean)
  if (phones.length === 0) return
  if (!(await ensureTable(clientId))) return
  try {
    await queryAsClient(
      clientId,
      `INSERT INTO deleted_leads (client_id, normalized_phone)
       SELECT $1, unnest($2::varchar[])
       ON CONFLICT (client_id, normalized_phone) DO UPDATE SET deleted_at = now()`,
      [clientId, phones]
    )
  } catch (err) {
    console.error('[deletedLeads] could not record deletions:', err)
  }
}

// Called by intake before creating a lead.
export async function wasLeadDeleted(clientId: string, normalizedPhone: string): Promise<boolean> {
  if (!normalizedPhone) return false
  if (!(await ensureTable(clientId))) return false
  try {
    const rows = await queryAsClient<{ one: number }>(
      clientId,
      `SELECT 1 AS one FROM deleted_leads WHERE client_id = $1 AND normalized_phone = $2`,
      [clientId, normalizedPhone]
    )
    return rows.length > 0
  } catch {
    return false
  }
}

// A number added by hand in the CRM is wanted again, so the tombstone is
// cleared — otherwise re-adding a deleted parent would silently do nothing.
export async function forgetDeletedLead(clientId: string, normalizedPhone: string): Promise<void> {
  if (!normalizedPhone) return
  if (!(await ensureTable(clientId))) return
  try {
    await queryAsClient(clientId, `DELETE FROM deleted_leads WHERE client_id = $1 AND normalized_phone = $2`, [
      clientId,
      normalizedPhone,
    ])
  } catch {
    // Not worth failing the create for.
  }
}
