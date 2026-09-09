// path: app/api/leads/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { query } from '@/lib/db'
import { getSession, AGENCY_ROLES } from '@/lib/auth'
import { handleWriteError } from '@/lib/apiError'
import { fetchLeadsPage } from '@/lib/leadsQuery'
import { normalizePhone } from '@/lib/leadIntake'
import { resolveAssignee } from '@/lib/leadAssignment'
import { startWelcomeOrAsk } from '@/lib/welcomeMessage'
import { createNotification } from '@/lib/notifications'

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

  // A counsellor adding a lead always owns it; otherwise an explicit choice
  // on the form wins, and only if neither applies do the institute's
  // automatic assignment settings get a say.
  let assignedCounsellorId: string | null =
    session.role === 'client_counsellor' ? session.id : body.assignedCounsellorId || null

  // One lead per phone number, full stop. The inbound channels
  // (lib/leadIntake.ts) already merge a repeat number into the existing
  // record; manual entry had no equivalent rule, so the same parent could be
  // typed in twice and end up owned by two counsellors calling them
  // separately.
  //
  // Refusing rather than merging is deliberate here: a person filling out
  // this form is looking at the screen and can be shown the existing lead,
  // whereas a webhook has nobody to tell.
  const normalized = normalizePhone(String(whatsappNumber))
  const existing = await query(
    `SELECT l.id, l.lead_number, l.full_name, l.pipeline_stage, l.created_at, u.full_name AS counsellor_name
     FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_counsellor_id
     WHERE l.normalized_phone = $1
     ORDER BY l.created_at ASC LIMIT 1`,
    [normalized]
  ).catch(() => [])

  if (existing[0]) {
    return NextResponse.json(
      {
        error: `This phone number is already on lead #${existing[0].lead_number} — ${existing[0].full_name}${
          existing[0].counsellor_name ? ` (with ${existing[0].counsellor_name})` : ''
        }. Open that lead instead of creating a second one.`,
        duplicate: true,
        lead: existing[0],
      },
      { status: 409 }
    )
  }

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

    // Auto-assignment runs after the insert rather than before it, because
    // the round-robin count and the rule matching both want the real lead
    // row (its source, campaign, grade) rather than the raw form body.
    if (!lead.assigned_counsellor_id) {
      const auto = await resolveAssignee(clientId, lead).catch(() => null)
      if (auto) {
        await query('UPDATE leads SET assigned_counsellor_id = $1 WHERE id = $2', [auto, lead.id])
        lead.assigned_counsellor_id = auto
        const [who] = await query<{ full_name: string }>('SELECT full_name FROM users WHERE id = $1', [auto])
        await query(
          `INSERT INTO activity_log (lead_id, activity_type, title, description)
           VALUES ($1, 'system', 'Counsellor Assigned', $2)`,
          [lead.id, `Assigned automatically to "${who?.full_name || 'counsellor'}".`]
        )
      }
    }

    // The bell had nothing to show for manually-added leads because this
    // call didn't exist — only the webhook paths recorded a notification.
    await createNotification({
      clientId,
      leadId: lead.id,
      type: 'new_lead',
      body: `${body.source || 'manual'} · added by ${session.fullName || session.email}`,
    })

    // Fires the Day 0 welcome template (e.g. hello_candid) — unless the
    // institute has asked to confirm first, in which case the lead is
    // parked as 'pending' and a prompt appears on top of it instead (see
    // lib/welcomeMessage.ts). NOT awaited directly (that made the form take
    // 10-30s, waiting on live Meta network calls) — but a bare unawaited
    // promise doesn't work either: Vercel can freeze/kill this function
    // the instant the response below is sent, silently cutting the send
    // off mid-flight. waitUntil() is the platform-supported way to keep
    // the function alive for this promise without making the response
    // wait for it.
    waitUntil(
      startWelcomeOrAsk(clientId, lead.id).catch((err) =>
        console.error(`[leads] welcome handling threw for lead ${lead.id}`, err)
      )
    )

    return NextResponse.json(lead)
  } catch (err: any) {
    // The check above has a race window — two people adding the same walk-in
    // at the same moment both pass it. idx_leads_client_normalized_phone is
    // what actually prevents the duplicate row; this turns the resulting
    // constraint error into the same readable message.
    if (err?.code === '23505' && String(err?.constraint || '').includes('normalized_phone')) {
      return NextResponse.json(
        { error: 'A lead with this phone number already exists.', duplicate: true },
        { status: 409 }
      )
    }
    return handleWriteError(err)
  }
}

// Swallows only "this table/column doesn't exist here" — a client database
// provisioned before a later migration ran genuinely has nothing to clean
// up, and that shouldn't block the delete. Anything else (a foreign key
// still holding the row, a permissions problem) is re-thrown so it surfaces
// as a real message. The previous blanket .catch(() => {}) is what hid the
// circular-key failure below and turned it into an unexplained
// "Could not delete the selected leads."
function ignoreMissingRelation(err: any): void {
  // 42P01 undefined_table, 42703 undefined_column
  if (err?.code === '42P01' || err?.code === '42703') return
  throw err
}

// Every table that stores a lead_id needs its rows cleared before the lead
// row itself can go, since none of these foreign keys cascade. Order
// doesn't matter between them (none reference each other), except
// wa_sequence_messages, which hangs off wa_sequences.id rather than
// lead_id directly and so has to go first.
async function deleteLeadDependents(leadId: string) {
  // leads and wa_sequences point at each other: wa_sequences.lead_id
  // references the lead, and leads.wa_sequence_id references the sequence.
  // That cycle makes the order below unsatisfiable on its own — removing
  // the sequence first violates leads.wa_sequence_id, and removing the
  // lead first violates wa_sequences.lead_id. Clearing the lead's pointer
  // breaks the cycle so both can then go in order.
  //
  // This is exactly why a lead with a started nurture sequence refused to
  // delete while a lead without one deleted fine.
  await query(`UPDATE leads SET wa_sequence_id = NULL WHERE id = $1`, [leadId]).catch(ignoreMissingRelation)

  await query(
    `DELETE FROM wa_sequence_messages WHERE sequence_id IN (SELECT id FROM wa_sequences WHERE lead_id = $1)`,
    [leadId]
  ).catch(ignoreMissingRelation)
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
    'notifications',
  ]
  for (const table of tables) {
    await query(`DELETE FROM ${table} WHERE lead_id = $1`, [leadId]).catch(ignoreMissingRelation)
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

  try {
    for (const row of deletable) {
      await deleteLeadDependents(row.id)
    }
    if (deletable.length > 0) {
      await query(
        `DELETE FROM leads WHERE id = ANY($1)`,
        [deletable.map((r) => r.id)]
      )
    }
  } catch (err: any) {
    // Naming the blocking table turns "Could not delete the selected leads."
    // into something actionable — a 23503 here means some table still holds
    // a row pointing at this lead and needs adding to the list above.
    console.error('[leads:delete] failed:', err)
    if (err?.code === '23503') {
      return NextResponse.json(
        {
          error: `This lead still has linked records (${err?.table || 'unknown table'}) that couldn't be removed. Nothing was deleted.`,
        },
        { status: 409 }
      )
    }
    return handleWriteError(err)
  }

  return NextResponse.json({
    deleted: deletable.length,
    skipped: skipped + (ids.length - rows.length),
  })
}
