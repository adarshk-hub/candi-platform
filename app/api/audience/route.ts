// path: app/api/audience/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { queryAsClient } from '@/lib/db'
import { getSession, AGENCY_ROLES } from '@/lib/auth'
import { handleWriteError } from '@/lib/apiError'
import { normalizeFilters, listAudience } from '@/lib/leadAudience'
import { savedGroups, sourceGroups } from '@/lib/audienceGroups'

function resolveClientId(session: ReturnType<typeof getSession>, requested?: string | null): string | null {
  if (!session) return null
  if (AGENCY_ROLES.includes(session.role)) return requested || session.clientId || null
  if (session.role === 'client_admin') return session.clientId
  return null
}

export async function GET(req: NextRequest) {
  const session = getSession(req)
  const clientId = resolveClientId(session, req.nextUrl.searchParams.get('clientId'))
  if (!clientId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    // Sequential, not Promise.all. Each half runs several queries, and the
    // Supabase pooler hands out a small fixed number of connection slots for
    // the whole project — doubling this page's concurrency to save a few
    // milliseconds is how one tab starts refusing to load because another is
    // mid-request.
    //
    // Source groups first: they're the ones that exist without anybody doing
    // anything, and on a fresh install they're the only ones there are.
    const sources = await sourceGroups(clientId)
    const saved = await savedGroups(clientId)
    return NextResponse.json({ sources, saved })
  } catch (err: any) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return NextResponse.json({
        migrationNeeded: true,
        sources: [],
        saved: [],
        error: 'Run scripts/phase4-migration.sql against this database first.',
      })
    }
    // The message is passed through rather than replaced with something
    // generic: an empty Audience tab and a broken one look identical from
    // the outside, and the difference matters when a table is missing or
    // the session isn't scoped to an institute.
    console.error('[audience] failed:', err)
    return NextResponse.json(
      { error: `Could not load audiences: ${err?.message || 'unknown error'}`, sources: [], saved: [] },
      { status: 500 }
    )
  }
}

// Saves a group two ways:
//   { kind: 'filters', filters }  — a live rule, re-evaluated whenever used
//   { kind: 'manual', filters }   — snapshots whoever matches right now
//
// The manual variant exists because some audiences are a decision, not a
// rule: "the parents we invited to the December open day" must not quietly
// gain new members in January.
export async function POST(req: NextRequest) {
  const session = getSession(req)
  const body = await req.json().catch(() => ({}))
  const clientId = resolveClientId(session, body?.clientId)
  if (!clientId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'Give the audience a name.' }, { status: 400 })

  const kind = body.kind === 'manual' ? 'manual' : 'filters'
  const filters = normalizeFilters(body.filters)

  try {
    const rows = await queryAsClient<{ id: string }>(
      clientId,
      `INSERT INTO audience_groups (client_id, name, description, kind, filters, origin, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        clientId,
        name,
        body.description || null,
        kind,
        JSON.stringify(filters),
        body.origin === 'broadcast' ? 'broadcast' : 'manual',
        session!.id,
      ]
    )
    const groupId = rows[0].id

    if (kind === 'manual') {
      // Either an explicit list of leads, or everyone matching the filters at
      // this moment — frozen either way.
      let leadIds: string[] = Array.isArray(body.leadIds) ? body.leadIds.filter((x: any) => typeof x === 'string') : []
      if (leadIds.length === 0) {
        const matched = await listAudience(clientId, filters)
        leadIds = matched.leads.map((l) => l.id)
      }
      for (const leadId of leadIds) {
        await queryAsClient(
          clientId,
          `INSERT INTO audience_group_members (group_id, lead_id) VALUES ($1,$2)
           ON CONFLICT DO NOTHING`,
          [groupId, leadId]
        )
      }
      return NextResponse.json({ id: groupId, members: leadIds.length })
    }

    return NextResponse.json({ id: groupId })
  } catch (err: any) {
    if (err?.code === '23505') {
      return NextResponse.json({ error: 'An audience with that name already exists.' }, { status: 409 })
    }
    if (err?.code === '42P01') {
      return NextResponse.json(
        { error: 'Run scripts/phase4-migration.sql against this database first.' },
        { status: 409 }
      )
    }
    return handleWriteError(err)
  }
}
