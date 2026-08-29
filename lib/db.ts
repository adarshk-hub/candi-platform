import { getServerSession } from './serverAuth'
import { getClientPool, centralPool } from './clientRegistry'

// query() now resolves the correct database automatically, from whoever is
// logged in for the current request — every one of the ~54 routes that
// already call query(sql, params) needs NO changes at all. This works
// because of one decision: each login is scoped to exactly one client, so
// session.clientId is always the right (and only) answer for "which
// database." There is no cross-client "see everything" mode any more.
//
// Two kinds of code CANNOT use this and must import centralQuery/centralPool
// directly instead:
//   1. Webhook routes (Meta calls these directly — there is no logged-in
//      session yet, since the whole point is figuring out which client the
//      incoming message belongs to).
//   2. Genuine platform-admin operations on the client registry itself
//      (creating a new client, listing all clients to manage them) — this
//      is registry data, not any one client's CRM data.
export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const session = getServerSession()
  if (!session || !session.clientId) {
    throw new Error(
      'query() requires a session scoped to one client. For webhook handlers or platform-admin operations, use centralQuery() from lib/db instead.'
    )
  }
  const pool = await getClientPool(session.clientId)
  const result = await pool.query(text, params)
  return result.rows
}

// For the small number of routes that are genuinely central-registry
// operations rather than any one client's data — see the note above.
export async function centralQuery<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await centralPool.query(text, params)
  return result.rows
}

// Explicit, session-independent version of query() — for background code
// that already knows exactly which client it's operating on (a webhook that
// just resolved the client via meta_page_id/api_key, a cron job looping
// over every client, a backfill given a clientId) rather than inferring it
// from whoever happens to be logged in. query() silently trusting
// session.clientId is correct for request handlers a person is logged into,
// but wrong here — there IS no session in these contexts, and even where
// there might incidentally be one, this is more honest about which client
// is actually being written to.
export async function queryAsClient<T = any>(clientId: string, text: string, params?: any[]): Promise<T[]> {
  const pool = await getClientPool(clientId)
  const result = await pool.query(text, params)
  return result.rows
}
