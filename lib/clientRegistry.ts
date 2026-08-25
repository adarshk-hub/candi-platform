import { Pool } from 'pg'
import { decrypt } from '@/lib/waEncryption'

// The central pool only ever queries the `clients` table (and, for now,
// `users` when no client is specified — see login route). It never touches
// leads, messages, or any other CRM data.
const globalForRegistry = globalThis as unknown as {
  centralPool?: Pool
  clientPools?: Map<string, Pool>
}

export const centralPool =
  globalForRegistry.centralPool ??
  new Pool({ connectionString: process.env.DATABASE_URL })

if (process.env.NODE_ENV !== 'production') globalForRegistry.centralPool = centralPool

const clientPools = globalForRegistry.clientPools ?? new Map<string, Pool>()
if (process.env.NODE_ENV !== 'production') globalForRegistry.clientPools = clientPools

export interface ClientRecord {
  id: string
  name: string
  slug: string | null
}

// Matches by slug first, falling back to the display name, both
// case-insensitive — so "candid-schools" and "Candid Schools" both work
// from the login form.
export async function resolveClient(nameOrSlug: string): Promise<ClientRecord | null> {
  const result = await centralPool.query<ClientRecord>(
    `SELECT id, name, slug FROM clients
     WHERE lower(slug) = lower($1) OR lower(name) = lower($1)
     LIMIT 1`,
    [nameOrSlug.trim()]
  )
  return result.rows[0] ?? null
}

// Returns a cached pool for a client's own database, decrypting the stored
// connection string on first use per warm serverless instance. Until a
// client has database_url_enc set, this throws — for Candid Schools today,
// that value should just be the encrypted form of the existing DATABASE_URL
// (see scripts/encrypt-value.js), so it resolves back to the same database.
export async function getClientPool(clientId: string): Promise<Pool> {
  const cached = clientPools.get(clientId)
  if (cached) return cached

  const result = await centralPool.query<{ database_url_enc: string | null }>(
    'SELECT database_url_enc FROM clients WHERE id = $1',
    [clientId]
  )
  const encrypted = result.rows[0]?.database_url_enc
  if (!encrypted) {
    throw new Error(`No database configured for client ${clientId} — set clients.database_url_enc first.`)
  }

  const pool = new Pool({ connectionString: decrypt(encrypted) })
  clientPools.set(clientId, pool)
  return pool
}
