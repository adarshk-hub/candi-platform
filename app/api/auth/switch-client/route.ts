import { NextRequest, NextResponse } from 'next/server'
import { getSession, signSession, AGENCY_ROLES, Role } from '@/lib/auth'
import { centralPool, getClientPoolFromRecord, ClientRecord } from '@/lib/clientRegistry'

// Every session is permanently scoped to exactly one client's own physical
// database (see lib/db.ts) — there is no "view across all clients" query
// mode. So "switching institutes" for an agency user can't just change a
// filter value; it has to swap out the session's cc_session cookie for one
// scoped to the target institute's own database, the same way logging in
// with a different institute name would. This route does that swap without
// making the person re-enter a password, but only into institutes where
// they already have their own provisioned (active, agency-role) account —
// exactly the accounts visible in that institute's own Settings > Users
// list. It intentionally does not create an account on the fly.
export async function POST(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!AGENCY_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Only agency accounts can switch institutions.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const clientId: string = body.clientId
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  // The central registry (the one DB every session can always reach,
  // regardless of which institute it's currently scoped to) is the only
  // place that knows every institute's connection string.
  const result = await centralPool.query<ClientRecord>(
    'SELECT id, name, slug, database_url_enc FROM clients WHERE id = $1',
    [clientId]
  )
  const target = result.rows[0]
  if (!target) return NextResponse.json({ error: 'Institution not found.' }, { status: 404 })
  if (!target.database_url_enc) {
    return NextResponse.json(
      { error: `${target.name} isn't fully set up yet — no database has been configured for it.` },
      { status: 400 }
    )
  }

  const pool = getClientPoolFromRecord(target)
  const userResult = await pool.query<{
    id: string
    email: string
    role: string
    full_name: string | null
    is_active: boolean
  }>('SELECT id, email, role, full_name, is_active FROM users WHERE email = $1', [session.email])
  const targetUser = userResult.rows[0]

  if (!targetUser || !targetUser.is_active || !AGENCY_ROLES.includes(targetUser.role as Role)) {
    return NextResponse.json(
      {
        error: `You don't have an agency account under ${target.name} yet. Ask an admin to add "${session.email}" under Settings > Users for that institute first.`,
      },
      { status: 403 }
    )
  }

  const token = signSession({
    id: targetUser.id,
    email: targetUser.email,
    role: targetUser.role as Role,
    clientId: target.id,
    fullName: targetUser.full_name,
  })

  const res = NextResponse.json({ ok: true, clientId: target.id, clientName: target.name })
  res.cookies.set('cc_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
  return res
}
