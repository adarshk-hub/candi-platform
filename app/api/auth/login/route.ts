import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { resolveClient, getClientPoolFromRecord } from '@/lib/clientRegistry'
import { signSession } from '@/lib/auth'

type UserRow = {
  id: string
  email: string
  password_hash: string
  role: string
  client_id: string | null
  full_name: string | null
  is_active: boolean
}

const USER_SELECT =
  'SELECT id, email, password_hash, role, client_id, full_name, is_active FROM users WHERE email = $1'

export async function POST(req: NextRequest) {
  const { client: clientNameOrSlug, email, password } = await req.json()
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  // Leaving "Client" blank resolves against one designated institute
  // instead of rejecting the request outright — set via env var so it's a
  // deliberate, reversible choice (e.g. temporarily during a payment
  // gateway's app-review process, where the reviewer is only ever going to
  // be given an email/password, never an institute name) rather than a
  // permanent bypass. Every real customer login still supplies their own
  // institute name/slug exactly as before; this only ever affects the
  // blank-client case, and unsetting the env var switches it back off.
  const effectiveClientNameOrSlug = clientNameOrSlug || process.env.DEFAULT_LOGIN_CLIENT_SLUG
  if (!effectiveClientNameOrSlug) {
    return NextResponse.json({ error: 'Client, email and password required' }, { status: 400 })
  }

  const client = await resolveClient(effectiveClientNameOrSlug)
  if (!client) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const pool = getClientPoolFromRecord(client)
  const result = await pool.query<UserRow>(USER_SELECT, [email])
  const user = result.rows[0]

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }
  if (!user.is_active) {
    return NextResponse.json({ error: 'This account has been deactivated.' }, { status: 401 })
  }

  const token = signSession({
    id: user.id,
    email: user.email,
    role: user.role as any,
    clientId: client.id,
    fullName: user.full_name,
  })

  const res = NextResponse.json({
    id: user.id,
    email: user.email,
    role: user.role,
    clientId: client.id,
    clientName: client.name,
    fullName: user.full_name,
  })
  res.cookies.set('cc_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('cc_session', '', { maxAge: 0, path: '/' })
  return res
}
