// path: app/api/email-broadcasts/audience-list/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession, AGENCY_ROLES } from '@/lib/auth'
import { listAudience, BroadcastFilters } from '@/lib/leadAudience'

// Returns the full matching audience so the composer can render one row per
// lead with a checkbox, rather than the 10-lead sample /preview returns.
// Mirrors /api/broadcasts/audience-list, but passes 'email' so leads with no
// email address are excluded — queueing them would only produce guaranteed
// failures in the recipients table.

function resolveClientId(session: ReturnType<typeof getSession>, requestedClientId?: string | null): string | null {
  if (!session) return null
  if (AGENCY_ROLES.includes(session.role)) return requestedClientId || null
  if (session.role === 'client_admin') return session.clientId
  return null
}

export async function POST(req: NextRequest) {
  const session = getSession(req)
  const body = await req.json().catch(() => null)
  const clientId = resolveClientId(session, body?.clientId)
  if (!clientId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const filters: BroadcastFilters = {
    tags: Array.isArray(body?.filters?.tags) ? body.filters.tags : [],
    tagsMode: body?.filters?.tagsMode === 'all' ? 'all' : 'any',
    stageKeys: Array.isArray(body?.filters?.stageKeys) ? body.filters.stageKeys : [],
    createdFrom: body?.filters?.createdFrom || null,
    createdTo: body?.filters?.createdTo || null,
    lastContactedFrom: body?.filters?.lastContactedFrom || null,
    lastContactedTo: body?.filters?.lastContactedTo || null,
  }

  const result = await listAudience(clientId, filters, 'email')
  return NextResponse.json(result)
}
