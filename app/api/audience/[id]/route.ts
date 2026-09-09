// path: app/api/audience/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession, AGENCY_ROLES } from '@/lib/auth'
import { handleWriteError } from '@/lib/apiError'
import { listAudience } from '@/lib/leadAudience'
import { resolveGroupFilters } from '@/lib/audienceGroups'

function resolveClientId(session: ReturnType<typeof getSession>, requested?: string | null): string | null {
  if (!session) return null
  if (AGENCY_ROLES.includes(session.role)) return requested || session.clientId || null
  if (session.role === 'client_admin') return session.clientId
  return null
}

// The members of one audience — used to show who is actually in a group
// before broadcasting to it.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  const clientId = resolveClientId(session, req.nextUrl.searchParams.get('clientId'))
  if (!clientId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const filters = await resolveGroupFilters(clientId, params.id)
  if (!filters) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const result = await listAudience(clientId, filters)
  return NextResponse.json({ ...result, filters })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  const clientId = resolveClientId(session, req.nextUrl.searchParams.get('clientId'))
  if (!clientId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Source groups are computed from the leads table, so there is nothing to
  // delete — saying so is better than a 404 that looks like a bug.
  if (params.id.startsWith('source:')) {
    return NextResponse.json(
      { error: 'Source audiences are built from your leads and can’t be deleted.' },
      { status: 400 }
    )
  }

  try {
    // Members go with it via ON DELETE CASCADE. Broadcasts already sent are
    // untouched: their recipient lists were copied at send time, so history
    // doesn't change because an audience was tidied up later.
    await query('DELETE FROM audience_groups WHERE id = $1 AND client_id = $2', [params.id, clientId])
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return handleWriteError(err)
  }
}
