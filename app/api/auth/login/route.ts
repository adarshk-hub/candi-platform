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
  const t0 = Date.now()
  const { client: clientNameOrSlug, email, password } = await req.json()
  if (!clientNameOrSlug || !email || !password) {
    return NextResponse.json({ error: 'Client, email and password required' }, { status: 400 })
  }

  // Every login — client staff and agency staff alike — resolves a client
  // by name first, then checks credentials against that client's own
  // database. There is no central/shared login path any more: each session
  // is scoped to exactly one client's data, with no exceptions.
  const client = await resolveClient(clientNameOrSlug)
  const tResolve = Date.now()
  if (!client) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const pool = getClientPoolFromRecord(client)
  const result = await pool.query<UserRow>(USER_SELECT, [email])
  const tUserQuery = Date.now()
  const user = result.rows[0]

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }
  const tBcrypt = Date.now()
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
  // TEMP DIAGNOSTIC — remove once we've confirmed where the time goes.
  console.log(
    `[login] resolveClient=${tResolve - t0}ms userQuery=${tUserQuery - tResolve}ms bcrypt=${tBcrypt - tUserQuery}ms total=${Date.now() - t0}ms`
  )
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('cc_session', '', { maxAge: 0, path: '/' })
  return res
}
