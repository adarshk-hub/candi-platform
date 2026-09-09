// path: app/api/activity/assign/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession, AGENCY_ROLES } from '@/lib/auth'
import { handleWriteError } from '@/lib/apiError'

// Bulk counsellor assignment for the Activity page. The per-lead equivalent
// already exists in PATCH /api/leads/[id]; this takes a list so a whole
// morning's unassigned intake can be distributed in one action instead of
// opening each lead in turn.
//
// Same permission rule as the single-lead reassign: agency staff, or the
// institute's own client_admin. A counsellor cannot hand leads to (or take
// them from) anyone.
export async function POST(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const canAssign = AGENCY_ROLES.includes(session.role) || session.role === 'client_admin'
  if (!canAssign) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const leadIds: string[] = Array.isArray(body.leadIds)
    ? body.leadIds.filter((id: any) => typeof id === 'string' && id)
    : []
  const counsellorId: string | null = body.counsellorId || null
  // Splits the selection evenly across several counsellors instead of giving
  // all of them to one — the usual way a day's intake actually gets divided.
  const roundRobinIds: string[] = Array.isArray(body.roundRobinIds)
    ? body.roundRobinIds.filter((id: any) => typeof id === 'string' && id)
    : []

  if (leadIds.length === 0) return NextResponse.json({ error: 'leadIds is required' }, { status: 400 })
  if (!counsellorId && roundRobinIds.length === 0 && body.counsellorId !== null) {
    return NextResponse.json({ error: 'counsellorId or roundRobinIds is required' }, { status: 400 })
  }

  // query() is already scoped to one institute's database, so anything that
  // doesn't resolve here belongs to somebody else and is simply skipped.
  const leads = await query<{ id: string; client_id: string; full_name: string; assigned_counsellor_id: string | null }>(
    `SELECT id, client_id, full_name, assigned_counsellor_id FROM leads WHERE id = ANY($1)`,
    [leadIds]
  )
  if (leads.length === 0) return NextResponse.json({ error: 'No matching leads.' }, { status: 404 })

  if (session.role === 'client_admin') {
    const foreign = leads.find((l) => l.client_id !== session.clientId)
    if (foreign) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const targets = roundRobinIds.length > 0 ? roundRobinIds : counsellorId ? [counsellorId] : [null]

  // Every named target must be a real counsellor at this institute, checked
  // before anything is written — a half-applied bulk assignment is much
  // harder to reason about than one that was refused outright.
  const named = targets.filter((t): t is string => !!t)
  if (named.length > 0) {
    const valid = await query<{ id: string; client_id: string; full_name: string }>(
      `SELECT id, client_id, full_name FROM users WHERE id = ANY($1) AND role = 'client_counsellor' AND is_active`,
      [named]
    )
    if (valid.length !== named.length) {
      return NextResponse.json({ error: 'One or more selected counsellors are not valid for this institute.' }, { status: 400 })
    }
    const wrongClient = valid.find((v) => v.client_id !== leads[0].client_id)
    if (wrongClient) {
      return NextResponse.json({ error: 'Counsellor belongs to a different institute.' }, { status: 400 })
    }
  }

  const nameRows = named.length
    ? await query<{ id: string; full_name: string }>(`SELECT id, full_name FROM users WHERE id = ANY($1)`, [named])
    : []
  const nameById = new Map(nameRows.map((r) => [r.id, r.full_name]))

  try {
    let updated = 0
    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i]
      const target = targets[i % targets.length]
      if (target === lead.assigned_counsellor_id) continue

      await query('UPDATE leads SET assigned_counsellor_id = $1 WHERE id = $2', [target, lead.id])
      await query(
        `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id)
         VALUES ($1, 'system', 'Counsellor Assigned', $2, $3)`,
        [
          lead.id,
          `Assigned to "${target ? nameById.get(target) || 'counsellor' : 'Unassigned'}" from the Activity page.`,
          session.id,
        ]
      )
      updated++
    }

    return NextResponse.json({ updated, skipped: leads.length - updated })
  } catch (err: any) {
    return handleWriteError(err)
  }
}
