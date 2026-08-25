import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { centralPool, resolveClient, getClientPool } from '@/lib/clientRegistry'
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

  let user: UserRow | undefined
  let resolvedClientId: string | null = null
  let resolvedClientName: string | null = null

  if (clientNameOrSlug) {
    // Client-side login (client_admin / client_counsellor): resolve the
    // client by name/slug first, then check credentials against that
    // client's own database. Today this still points back at the same
    // shared database for Candid Schools — see scripts/multi-tenant-registry.sql.
    const client = await resolveClient(clientNameOrSlug)
    if (!client) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }
    const pool = await getClientPool(client.id)
    const result = await pool.query<UserRow>(USER_SELECT, [email])
    user = result.rows[0]
    resolvedClientId = client.id
    resolvedClientName = client.name
  } else {
    // No client given: agency staff (agency_admin / agency_staff) aren't
    // tied to one client, so they authenticate against the central table
    // directly, same as today.
    const result = await centralPool.query<UserRow>(USER_SELECT, [email])
    user = result.rows[0]
  }

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }
  if (!user.is_active) {
    return NextResponse.json({ error: 'This account has been deactivated.' }, { status: 401 })
  }

  const clientId = resolvedClientId ?? user.client_id

  const token = signSession({
    id: user.id,
    email: user.email,
    role: user.role as any,
    clientId,
    fullName: user.full_name,
  })

  const res = NextResponse.json({
    id: user.id,
    email: user.email,
    role: user.role,
    clientId,
    clientName: resolvedClientName,
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
