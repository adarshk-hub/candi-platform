// path: app/api/unsubscribe/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { centralPool } from '@/lib/clientRegistry'
import { queryAsClient } from '@/lib/db'

// Deliberately unauthenticated — it is reached from a link in an email, by
// someone who by definition cannot log in. The token is the credential: a
// random per-lead UUID, so knowing one tells you nothing about any other.
//
// POST rather than GET. Mail clients and security scanners pre-fetch links
// in messages, and a GET here would unsubscribe people who never clicked.
export async function POST(req: NextRequest) {
  const { token } = await req.json().catch(() => ({}))
  if (!token) return NextResponse.json({ error: 'Missing token.' }, { status: 400 })

  // Which institute the token belongs to is unknown at this point, so every
  // client database is checked. Fine at this scale, and the alternative —
  // encoding the client id in the URL — would leak it into every inbox.
  const clients = await centralPool
    .query<{ id: string; name: string }>('SELECT id, name FROM clients')
    .then((r) => r.rows)
    .catch(() => [])

  for (const client of clients) {
    try {
      const rows = await queryAsClient<{ id: string; full_name: string }>(
        client.id,
        `UPDATE leads SET email_unsubscribed_at = COALESCE(email_unsubscribed_at, now())
         WHERE unsubscribe_token = $1
         RETURNING id, full_name`,
        [token]
      )
      if (rows[0]) {
        await queryAsClient(
          client.id,
          `INSERT INTO activity_log (lead_id, activity_type, title, description)
           VALUES ($1, 'system', 'Unsubscribed', 'Opted out of broadcast emails via the unsubscribe link.')`,
          [rows[0].id]
        ).catch(() => {})
        return NextResponse.json({ ok: true, institute: client.name })
      }
    } catch {
      // A client database missing the column (migration not run) shouldn't
      // stop the others being checked.
      continue
    }
  }

  // Deliberately the same response as success. Telling an anonymous caller
  // whether a token exists turns this into a way to test guesses.
  return NextResponse.json({ ok: true })
}
