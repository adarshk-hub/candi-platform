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
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    // keepAlive stops the OS/DB from silently dropping an idle TCP
    // connection between requests — without it, a Postgres provider's own
    // idle timeout (common on managed/serverless Postgres) can quietly
    // close the socket, so what looks like a "warm" serverless instance
    // still ends up paying for a brand new TCP+TLS+auth handshake on its
    // next request anyway. connectionTimeoutMillis makes a genuinely dead
    // connection fail fast (5s) instead of hanging.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  })

if (process.env.NODE_ENV !== 'production') globalForRegistry.centralPool = centralPool

const clientPools = globalForRegistry.clientPools ?? new Map<string, Pool>()
if (process.env.NODE_ENV !== 'production') globalForRegistry.clientPools = clientPools

export interface ClientRecord {
  id: string
  name: string
  slug: string | null
  database_url_enc: string | null
}

// Caches resolveClient() results per warm instance — an institute's
// name/slug → id/database_url_enc mapping essentially never changes, so
// there's no reason every single login should pay for a full central-DB
// round trip just to look it up again. 5 minutes is generous enough to
// help real traffic patterns (the same institute logging in repeatedly)
// while still picking up a renamed/reconfigured client reasonably quickly.
const CLIENT_RESOLVE_TTL_MS = 5 * 60 * 1000
const globalForResolve = globalThis as unknown as {
  clientResolveCache?: Map<string, { record: ClientRecord | null; expiresAt: number }>
}
const clientResolveCache = globalForResolve.clientResolveCache ?? new Map()
if (process.env.NODE_ENV !== 'production') globalForResolve.clientResolveCache = clientResolveCache

// Matches by slug first, falling back to the display name, both
// case-insensitive — so "candid-schools" and "Candid Schools" both work
// from the login form. Also selects database_url_enc so callers who already
// have the ClientRecord (e.g. login) can seed the pool cache via
// getClientPoolFromRecord() below instead of paying for a second centralPool
// round-trip to look it up again.
export async function resolveClient(nameOrSlug: string): Promise<ClientRecord | null> {
  const key = nameOrSlug.trim().toLowerCase()
  const cached = clientResolveCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.record

  const result = await centralPool.query<ClientRecord>(
    `SELECT id, name, slug, database_url_enc FROM clients
     WHERE lower(slug) = lower($1) OR lower(name) = lower($1)
     LIMIT 1`,
    [nameOrSlug.trim()]
  )
  const record = result.rows[0] ?? null
  clientResolveCache.set(key, { record, expiresAt: Date.now() + CLIENT_RESOLVE_TTL_MS })
  return record
}

function buildPool(encrypted: string): Pool {
  return new Pool({
    connectionString: decrypt(encrypted),
    ssl: { rejectUnauthorized: false },
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  })
}

// Returns a cached pool for a client's own database, decrypting the stored
// connection string on first use per warm serverless instance.
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

  const pool = buildPool(encrypted)
  clientPools.set(clientId, pool)
  return pool
}

// Same as getClientPool, but for callers that already have a ClientRecord
// (from resolveClient) — skips the redundant centralPool lookup by id.
export function getClientPoolFromRecord(client: ClientRecord): Pool {
  const cached = clientPools.get(client.id)
  if (cached) return cached

  if (!client.database_url_enc) {
    throw new Error(`No database configured for client ${client.id} — set clients.database_url_enc first.`)
  }

  const pool = buildPool(client.database_url_enc)
  clientPools.set(client.id, pool)
  return pool
}
