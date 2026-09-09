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

// Sized for serverless, but not starved.
//
// pg's default of 10 per pool is too many when Supabase's session-mode
// pooler gives roughly 15 slots for the entire project, shared by every warm
// instance — that combination is what produced "(EMAXCONNSESSION) max
// clients reached in session mode". But going to 1 is worse: a single slow
// query then blocks every other query on that instance behind it until they
// time out. Five leaves room for a page that fires a few requests at once
// while staying well clear of the cap.
//
// If EMAXCONNSESSION comes back, the pool size is not the lever. Check
// whether DATABASE_URL (and clients.database_url_enc) point at port 5432
// rather than 6543. Port 5432 is session mode, where a connection is held
// for the whole session and the cap really is ~15. Port 6543 is transaction
// mode, which returns the connection after each statement and allows
// hundreds of concurrent clients. pg works with it here because this
// codebase never names prepared statements.
const CLIENT_POOL_MAX = 5
const CENTRAL_POOL_MAX = 3
// Released after 10s idle rather than pg's 30s default, so a serverless
// instance that has finished its request hands slots back reasonably fast.
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
  // allowExitOnIdle is deliberately NOT set. It lets a pool shut itself
  // down once every connection goes idle — which, combined with caching
  // pools on globalThis below, leaves a dead pool sitting in the cache that
  // the next request happily pulls out and tries to query. That failure mode
  // looks like requests hanging rather than erroring, which is far harder to
  // recognise than the connection-limit error it was meant to help with.
}

// Logged once per cold start. If the port here is 5432, the connection
// errors are coming from session mode's ~15-slot cap and no pool setting
// will fix them — switch to the 6543 transaction-mode string.
try {
  const url = new URL(process.env.DATABASE_URL || '')
  if (url.port === '5432') {
    console.warn(
      '[clientRegistry] DATABASE_URL uses port 5432 (session mode, ~15 connections for the whole project). ' +
        'Switch to the port 6543 transaction-mode pooler string for serverless.'
    )
  }
} catch {
  // No DATABASE_URL, or not a parseable URL — nothing useful to warn about.
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
