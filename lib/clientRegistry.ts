// path: lib/clientRegistry.ts
import { Pool } from 'pg'
import { decrypt } from '@/lib/waEncryption'

// The central pool only ever queries the `clients` table (and, for now,
// `users` when no client is specified — see login route). It never touches
// leads, messages, or any other CRM data.
const globalForRegistry = globalThis as unknown as {
  centralPool?: Pool
  clientPools?: Map<string, Pool>
}

// How many sockets a single pool may hold open.
//
// pg defaults to 10, which is what caused
// "(EMAXCONNSESSION) max clients reached in session mode - max clients are
// limited to pool_size: 15": the central pool alone could claim 10 and one
// institute's pool another 10, so the second page to do any real work got
// refused. Supabase's session-mode pooler hands out a fixed, small number of
// slots for the whole project, shared by every serverless instance at once —
// so each pool has to stay modest and give connections back quickly.
//
// Three is enough for a request that runs a handful of sequential queries
// (which is nearly all of them here) while leaving room for other instances.
const CLIENT_POOL_MAX = 3
// Two, because the central pool only ever does single-row registry lookups.
const CENTRAL_POOL_MAX = 2
// Released after 10s idle rather than pg's 30s default: on serverless, an
// instance often handles one request and then sits idle, holding slots the
// next instance needs.
const IDLE_TIMEOUT_MS = 10_000

const POOL_DEFAULTS = {
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
  idleTimeoutMillis: IDLE_TIMEOUT_MS,
  allowExitOnIdle: true,
}

export const centralPool =
  globalForRegistry.centralPool ??
  (() => {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: CENTRAL_POOL_MAX,
      ...POOL_DEFAULTS,
    })
    pool.on('error', (err) => console.error('[clientRegistry] idle central client error:', err.message))
    return pool
  })()

// Cached in production too, not just development.
//
// The previous `if (NODE_ENV !== 'production')` guard was the standard
// hot-reload workaround, but on serverless it had the opposite of the
// intended effect: nothing was ever stored on globalThis in production, so
// every module re-evaluation built brand new pools while the old ones kept
// their sockets — connections leaked until the pooler started refusing them.
// Reusing across re-evaluations is exactly what production needs most.
globalForRegistry.centralPool = centralPool

const clientPools = globalForRegistry.clientPools ?? new Map<string, Pool>()
globalForRegistry.clientPools = clientPools

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
globalForResolve.clientResolveCache = clientResolveCache

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
  const pool = new Pool({
    connectionString: decrypt(encrypted),
    max: CLIENT_POOL_MAX,
    ...POOL_DEFAULTS,
  })

  // Without a listener, a socket dropped by the database (a pooler restart,
  // an idle timeout on the server side) raises an unhandled 'error' event
  // that takes the whole Node process down. pg removes the connection from
  // the pool by itself; logging is all that's needed.
  pool.on('error', (err) => {
    console.error('[clientRegistry] idle client error:', err.message)
  })

  return pool
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
