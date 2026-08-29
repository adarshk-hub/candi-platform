import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { query } from '@/lib/db'
import { getSession, AGENCY_ROLES } from '@/lib/auth'
import { handleWriteError } from '@/lib/apiError'
import { startSequence } from '@/lib/waSequenceEngine'
import { fetchLeadsPage } from '@/lib/leadsQuery'

function splitParam(v: string | null): string[] {
  return (v || '').split(',').map((s) => s.trim()).filter(Boolean)
}

// Client-side re-fetches only (filtering, searching, paging, refresh after
// an action). The very first paint of /leads doesn't come through here at
// all — the server-rendered page calls fetchLeadsPage() directly during
// render instead, so there's no empty flash waiting on a browser round
// trip. See app/leads/page.tsx.
export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const result = await fetchLeadsPage(session, {
    page: Math.max(1, Number(sp.get('page') || '1')),
    search: sp.get('search')?.trim() || '',
    tab: sp.get('tab') || '',
    stage: splitParam(sp.get('stage')),
    source: splitParam(sp.get('source')),
    grade: splitParam(sp.get('grade')),
  })

  return NextResponse.json(result)
}

// Manual lead entry from the "Add Lead" button — the counterpart to the
// webhook-driven findOrCreateLead() in lib/leadIntake.ts, which is built
// around dedup/merge semantics for inbound channels rather than a
// counsellor filling out a full form by hand.
export async function POST(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const clientId = AGENCY_ROLES.includes(session.role) ? body.clientId : session.clientId
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  if (session.role === 'client_admin' && clientId !== session.clientId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { fullName, whatsappNumber } = body
  if (!fullName || !whatsappNumber) {
    return NextResponse.json({ error: 'fullName and whatsappNumber required' }, { status: 400 })
  }

  const assignedCounsellorId = session.role === 'client_counsellor' ? session.id : body.assignedCounsellorId || null

  try {
    const rows = await query(
      `INSERT INTO leads (
        client_id, full_name, child_name, whatsapp_number, second_phone, email,
        occupation, company_name, location, grade, service_interested_in,
        source, timeline, decision_maker, competitors_visited, key_concern,
        entry_type, assigned_counsellor_id, custom_fields
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'manual',$17,$18)
      RETURNING *`,
      [
        clientId,
        fullName,
        body.childName || null,
        whatsappNumber,
        body.secondPhone || null,
        body.email || null,
        body.occupation || null,
        body.companyName || null,
        body.location || null,
        body.grade || null,
        body.serviceInterestedIn || null,
        body.source || 'manual',
        body.timeline || null,
        body.decisionMaker || null,
        body.competitorsVisited || null,
        body.keyConcern || null,
        assignedCounsellorId,
        JSON.stringify(body.customFields || {}),
      ]
    )
    const lead = rows[0]

    await query(
      `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id)
       VALUES ($1, 'system', 'Lead Created', $2, $3)`,
      [lead.id, `New lead added manually: ${fullName} - ${whatsappNumber}.`, session.id]
    )

    // Fires the Day 0 welcome template (e.g. hello_candid) immediately —
    // this is a brand-new lead the counsellor just entered by hand, so it
    // should feel like the same "first touch" as a lead arriving from an
    // ad or landing page. NOT awaited directly (that made the form take
    // 10-30s, waiting on live Meta network calls) — but a bare unawaited
    // promise doesn't work either: Vercel can freeze/kill this function
    // the instant the response below is sent, silently cutting the send
    // off mid-flight. waitUntil() is the platform-supported way to keep
    // the function alive for this promise without making the response
    // wait for it.
    waitUntil(
      startSequence(lead.id)
        .then((r) => {
          if (!r.ok) console.error(`[leads] Could not start welcome sequence for lead ${lead.id}: ${r.error}`)
        })
        .catch((err) => console.error(`[leads] startSequence threw for lead ${lead.id}`, err))
    )

    return NextResponse.json(lead)
  } catch (err: any) {
    return handleWriteError(err)
  }
}

// Every table that stores a lead_id needs its rows cleared before the lead
// row itself can go, since none of these foreign keys cascade. Order
// doesn't matter between them (none reference each other), except
// wa_sequence_messages, which hangs off wa_sequences.id rather than
// lead_id directly and so has to go first.
async function deleteLeadDependents(leadId: string) {
  await query(
    `DELETE FROM wa_sequence_messages WHERE sequence_id IN (SELECT id FROM wa_sequences WHERE lead_id = $1)`,
    [leadId]
  ).catch(() => {})
  const tables = [
    'wa_sequences',
    'whatsapp_messages',
    'email_messages',
    'email_broadcast_recipients',
    'wa_broadcast_recipients',
    'capi_event_log',
    'lead_tags',
    'lead_actions',
    'activity_log',
    'follow_ups',
    'enrollments',
    'events',
  ]
  for (const table of tables) {
    // Wrapped per-table: an environment missing one of these optional
    // tables (e.g. a client DB provisioned before a later migration ran)
    // shouldn't block deleting the lead itself.
    await query(`DELETE FROM ${table} WHERE lead_id = $1`, [leadId]).catch(() => {})
  }
}

// Bulk delete for the leads list's multi-select toolbar. Takes a list of
// lead ids in the body rather than a single id in the URL so the whole
// selection can go in one request instead of N round trips.
export async function DELETE(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((id: any) => typeof id === 'string' && id) : []
  if (ids.length === 0) return NextResponse.json({ error: 'ids array is required' }, { status: 400 })

  // query() is already scoped to the caller's own client database, so any
  // id here that doesn't resolve is either a stale row or belongs to
  // someone else's institute entirely — either way it's simply skipped
  // rather than erroring the whole batch.
  const rows = await query<{ id: string; assigned_counsellor_id: string | null }>(
    `SELECT id, assigned_counsellor_id FROM leads WHERE id = ANY($1)`,
    [ids]
  )

  const deletable = rows.filter(
    (r) => session.role !== 'client_counsellor' || r.assigned_counsellor_id === session.id
  )
  const skipped = rows.length - deletable.length

  for (const row of deletable) {
    await deleteLeadDependents(row.id)
  }
  if (deletable.length > 0) {
    await query(
      `DELETE FROM leads WHERE id = ANY($1)`,
      [deletable.map((r) => r.id)]
    )
  }

  return NextResponse.json({
    deleted: deletable.length,
    skipped: skipped + (ids.length - rows.length),
  })
}
