// path: app/api/leads/[id]/route.ts
//Re
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { query } from '@/lib/db'
import { getSession, AGENCY_ROLES } from '@/lib/auth'
import { getStageLabel } from '@/lib/stagesServer'
import { DECISION_MAKER_LABEL } from '@/lib/types'
import { sendOperationalTemplate } from '@/lib/metaWhatsapp'
import { sendEmail } from '@/lib/email'
import { renderEmailTemplate, POST_VISIT_SUMMARY_KEY } from '@/lib/emailTemplates'
import { pauseSequenceForLead, resumeSequenceForLead } from '@/lib/waSequenceEngine'
import { fireCapiEventForLead } from '@/lib/capiTriggers'
import { normalizePhone } from '@/lib/leadIntake'

const LEAD_QUERY = `
  SELECT
    l.*,
    c.display_name AS campaign_display_name,
    c.platform AS campaign_platform,
    u.full_name AS counsellor_name,
    cl.name AS client_name
  FROM leads l
  LEFT JOIN campaigns c ON c.id = l.campaign_id
  LEFT JOIN users u ON u.id = l.assigned_counsellor_id
  LEFT JOIN clients cl ON cl.id = l.client_id
  WHERE l.id = $1
`

// Fields the Info tab's edit form is allowed to write. Keyed to the exact
// leads columns so we can build a whitelisted, dynamic UPDATE below.
// assigned_counsellor_id is handled separately below — it needs its own
// permission gate (not every role that can edit info fields may reassign).
const EDITABLE_FIELDS = [
  'full_name',
  'child_name',
  'whatsapp_number',
  'second_phone',
  'email',
  'occupation',
  'company_name',
  'location',
  'grade',
  'service_interested_in',
  'source',
  'timeline',
  'decision_maker',
  'competitors_visited',
  'key_concern',
] as const

const FIELD_LABEL: Record<string, string> = {
  full_name: 'Lead Name',
  child_name: 'Child Name',
  whatsapp_number: 'WhatsApp',
  second_phone: 'Phone',
  email: 'Email',
  occupation: 'Occupation',
  company_name: 'Company Name',
  location: 'City',
  grade: "Child's Class",
  service_interested_in: 'Course',
  source: 'Source',
  timeline: 'Joining timeline',
  decision_maker: 'Decision maker',
  competitors_visited: 'Competitors shortlisted',
  key_concern: 'Key concern',
}

const DECISION_MAKER_VALUES = Object.keys(DECISION_MAKER_LABEL)

interface TargetStage {
  label: string
  status_group: string
  is_cold_lane: boolean
}

// "Cold" isn't a fixed stage key — each institute defines its own pipeline,
// marking stages either with status_group = 'cold' or as the dedicated cold
// lane. Both count, so the reason prompt fires for whichever way an institute
// has set theirs up.
async function loadTargetStage(clientId: string, key: string): Promise<TargetStage | null> {
  const rows = await query<TargetStage>(
    'SELECT label, status_group, is_cold_lane FROM pipeline_stages WHERE client_id = $1 AND key = $2',
    [clientId, key]
  )
  return rows[0] || null
}

function isColdStage(stage: TargetStage | null): boolean {
  return !!stage && (stage.status_group === 'cold' || stage.is_cold_lane)
}

// Writes the stage change together with the cold-reason columns in one
// statement, so a lead can never be observed sitting in a cold stage with no
// reason attached (or, going the other way, holding a stale reason after
// being revived).
//
// The CASE arms are what keep a cold → cold move from wiping a reason that
// was recorded earlier: a new reason replaces the old one, and no new reason
// leaves what's already there alone.
async function updateStageWithColdReason(
  leadId: string,
  stageKey: string,
  cold: boolean,
  reason: string,
  note: string
) {
  try {
    const rows = await query(
      `UPDATE leads SET
         pipeline_stage = $1,
         cold_reason = CASE WHEN $3 THEN COALESCE(NULLIF($4, ''), cold_reason) ELSE NULL END,
         cold_reason_note = CASE
           WHEN NOT $3 THEN NULL
           WHEN NULLIF($4, '') IS NOT NULL THEN NULLIF($5, '')
           ELSE cold_reason_note
         END,
         cold_reason_at = CASE
           WHEN NOT $3 THEN NULL
           WHEN NULLIF($4, '') IS NOT NULL THEN now()
           ELSE cold_reason_at
         END
       WHERE id = $2
       RETURNING *`,
      [stageKey, leadId, cold, reason, note]
    )
    return rows[0]
  } catch (err: any) {
    // 42703 undefined_column — a database that hasn't had
    // scripts/activity-migration.sql applied yet. Moving a lead between
    // stages is core to using the CRM at all and must not start failing
    // just because the reason columns aren't there; the stage change goes
    // through and the reason is simply not stored.
    if (err?.code !== '42703') throw err
    const rows = await query('UPDATE leads SET pipeline_stage = $1 WHERE id = $2 RETURNING *', [stageKey, leadId])
    return rows[0]
  }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await query(LEAD_QUERY, [params.id])
  const lead = rows[0]
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if ((session.role === 'client_admin' || session.role === 'client_staff') && lead.client_id !== session.clientId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (session.role === 'client_counsellor' && lead.assigned_counsellor_id !== session.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json(lead)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = (await query('SELECT * FROM leads WHERE id = $1', [params.id]))[0]
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isAgency = AGENCY_ROLES.includes(session.role)
  const isOwningCounsellor =
    session.role === 'client_counsellor' && existing.assigned_counsellor_id === session.id
  const isOwningClientAdmin =
    (session.role === 'client_admin' || session.role === 'client_staff') && existing.client_id === session.clientId
  if (!isAgency && !isOwningCounsellor && !isOwningClientAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  let updated = existing

  const coldReason = typeof body.cold_reason === 'string' ? body.cold_reason.trim() : ''
  const coldReasonNote = typeof body.cold_reason_note === 'string' ? body.cold_reason_note.trim() : ''

  // Stage change (from the header's stage pill) — keeps its own activity entry.
  if (body.pipeline_stage) {
    const targetStage = await loadTargetStage(existing.client_id, body.pipeline_stage)
    const movingToCold = isColdStage(targetStage)
    const isStageChange = body.pipeline_stage !== existing.pipeline_stage

    // Refused rather than saved-then-nagged: a reason collected days later,
    // once nobody remembers the call, is worth very little, and the whole
    // point of the Activity page's cold breakdown is that the reasons are
    // actually there. The client turns this 400 into the reason prompt.
    if (movingToCold && isStageChange && !coldReason && !existing.cold_reason) {
      return NextResponse.json(
        {
          error: 'Choose a reason before moving this lead to a cold stage.',
          requiresColdReason: true,
          stage: body.pipeline_stage,
          stageLabel: targetStage?.label || body.pipeline_stage,
        },
        { status: 400 }
      )
    }

    updated = await updateStageWithColdReason(
      params.id,
      body.pipeline_stage,
      movingToCold,
      coldReason,
      coldReasonNote
    )

    if (body.pipeline_stage !== existing.pipeline_stage) {
      const fromLabel = await getStageLabel(existing.client_id, existing.pipeline_stage)
      const toLabel = await getStageLabel(existing.client_id, body.pipeline_stage)
      const commentSuffix = body.comment ? ` Comment: "${body.comment}".` : ''
      const reasonSuffix = coldReason
        ? ` Cold reason: "${coldReason}"${coldReasonNote ? ` — ${coldReasonNote}` : ''}.`
        : ''
      await query(
        `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id)
         VALUES ($1, 'system', 'Stage Updated', $2, $3)`,
        [
          params.id,
          `Stage changed from "${fromLabel}" to "${toLabel}" via table.${commentSuffix}${reasonSuffix} Current Stage is "${toLabel}".`,
          session.id,
        ]
      )

      // Meta Conversions API — fires whatever event this institute has
      // mapped the new stage to in Settings > Customize > Conversions API,
      // or (in CRM mode) the raw stage key. No-ops instantly if CAPI isn't
      // configured for this client; never blocks or fails the stage update.
      //
      // Wrapped in waitUntil() rather than void: Vercel can freeze this
      // function the instant the response is returned, killing any promise
      // still in flight. That made CAPI silently work for stages with
      // awaited follow-up work below (visit_done sends WhatsApp and email,
      // which kept the instance alive long enough) and silently fail for
      // stages with none — offer_made produced no capi_event_log row at
      // all, not even a failure. waitUntil is what the other three call
      // sites already use; this one was missed.
      waitUntil(
        fireCapiEventForLead({
          lead: updated,
          trigger: body.pipeline_stage,
          eventIdSeed: `lead:${params.id}:stage:${body.pipeline_stage}`,
        })
      )

      // Auto-send a post-visit summary the moment a visit is marked done —
      // no counsellor action required.
      if (body.pipeline_stage === 'visit_done') {
        const result = await sendOperationalTemplate({
          clientId: existing.client_id,
          to: existing.whatsapp_number,
          slug: 'post_visit_summary',
          destinationName: existing.full_name,
        })
        await query(
          `INSERT INTO whatsapp_messages (lead_id, direction, message_type, body, template_name, status)
           VALUES ($1, 'outbound', 'template', 'Post-visit summary sent.', $2, $3)`,
          [params.id, 'post_visit_summary', result.ok ? 'sent' : 'failed']
        )
        await query(
          `INSERT INTO activity_log (lead_id, activity_type, title, description)
           VALUES ($1, 'system', 'Post-Visit Summary Sent', $2)`,
          [params.id, `Auto-triggered by stage change to "Visit Done". ${result.ok ? 'Sent' : `Failed: ${result.error}`} via Meta WhatsApp API.`]
        )

        // Same auto-trigger fires the email counterpart, if the lead has an
        // address and the institute has a school mailbox connected —
        // silently no-ops otherwise (no email to send to / no sender set up).
        if (existing.email) {
          const [client] = await query(
            `SELECT name, school_email, email_from_name, smtp_host, smtp_port, smtp_user, smtp_pass
             FROM clients WHERE id = $1`,
            [existing.client_id]
          )
          if (client) {
            const { subject, body: emailBody } = renderEmailTemplate(POST_VISIT_SUMMARY_KEY, {
              leadName: existing.full_name,
              instituteName: client.name,
            })
            const emailResult = await sendEmail(
              {
                host: client.smtp_host,
                port: client.smtp_port,
                user: client.smtp_user,
                pass: client.smtp_pass,
                fromEmail: client.school_email,
                fromName: client.email_from_name,
              },
              { to: existing.email, subject, body: emailBody }
            )
            await query(
              `INSERT INTO email_messages (lead_id, template_key, subject, body, to_email, status, error)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [params.id, POST_VISIT_SUMMARY_KEY, subject, emailBody, existing.email, emailResult.ok ? 'sent' : 'failed', emailResult.error || null]
            )
          }
        }
      }
    }
  }

  // Recording or correcting the reason on a lead that is already cold — used
  // by the Activity page to fill in the gaps for leads that went cold before
  // the prompt existed, without having to move them out of the stage and
  // back in again.
  if (!body.pipeline_stage && coldReason) {
    try {
      const rows = await query(
        `UPDATE leads SET cold_reason = $1, cold_reason_note = NULLIF($2, ''), cold_reason_at = now()
         WHERE id = $3 RETURNING *`,
        [coldReason, coldReasonNote, params.id]
      )
      updated = rows[0]
      await query(
        `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id)
         VALUES ($1, 'system', 'Cold Reason Recorded', $2, $3)`,
        [params.id, `Reason: "${coldReason}"${coldReasonNote ? ` — ${coldReasonNote}` : ''}.`, session.id]
      )
    } catch (err: any) {
      if (err?.code !== '42703') throw err
    }
  }

  // Nurture sequence pause/resume — any role with write access to this lead
  // (agency, owning counsellor, owning client_admin) can take manual control
  // of the thread without losing the sequence's current day position. This
  // toggle drives the real Meta wa_sequences row (see lib/waSequenceEngine.ts);
  // leads.nurture_paused itself is just a denormalized read for the UI.
  if ('nurture_paused' in body && typeof body.nurture_paused === 'boolean') {
    if (body.nurture_paused) {
      await pauseSequenceForLead(params.id, `Paused manually by ${session.fullName || session.email}`)
    } else {
      await resumeSequenceForLead(params.id)
    }

    const rows = await query('UPDATE leads SET nurture_paused = $1 WHERE id = $2 RETURNING *', [
      body.nurture_paused,
      params.id,
    ])
    updated = rows[0]
    await query(
      `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id)
       VALUES ($1, 'system', 'Nurture Sequence', $2, $3)`,
      [params.id, body.nurture_paused ? 'Sequence paused.' : 'Sequence resumed.', session.id]
    )
  }

  // Counsellor reassignment — restricted to agency roles and the owning
  // client_admin; a counsellor cannot reassign a lead away from themselves.
  if ('assigned_counsellor_id' in body) {
    if (!isAgency && !isOwningClientAdmin) {
      return NextResponse.json({ error: 'Forbidden: cannot reassign counsellor' }, { status: 403 })
    }
    const newCounsellorId: string | null = body.assigned_counsellor_id || null
    if (newCounsellorId) {
      const counsellor = (await query(
        `SELECT id, full_name, client_id FROM users WHERE id = $1 AND role = 'client_counsellor'`,
        [newCounsellorId]
      ))[0]
      if (!counsellor || counsellor.client_id !== existing.client_id) {
        return NextResponse.json({ error: 'Invalid counsellor for this client' }, { status: 400 })
      }
    }
    if (newCounsellorId !== existing.assigned_counsellor_id) {
      const rows = await query('UPDATE leads SET assigned_counsellor_id = $1 WHERE id = $2 RETURNING *', [
        newCounsellorId,
        params.id,
      ])
      updated = rows[0]

      const [fromName, toName] = await Promise.all([
        existing.assigned_counsellor_id
          ? query('SELECT full_name FROM users WHERE id = $1', [existing.assigned_counsellor_id]).then((r) => r[0]?.full_name)
          : Promise.resolve(null),
        newCounsellorId
          ? query('SELECT full_name FROM users WHERE id = $1', [newCounsellorId]).then((r) => r[0]?.full_name)
          : Promise.resolve(null),
      ])
      await query(
        `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id)
         VALUES ($1, 'system', 'Counsellor Reassigned', $2, $3)`,
        [params.id, `Counsellor changed from "${fromName || 'Unassigned'}" to "${toName || 'Unassigned'}".`, session.id]
      )
    }
  }

  // Info-tab field edits — whitelisted, dynamic UPDATE + a single diff-summary activity entry.
  const fieldUpdates = EDITABLE_FIELDS.filter((f) => f in body)
  if (fieldUpdates.length > 0) {
    if (body.decision_maker && !DECISION_MAKER_VALUES.includes(body.decision_maker)) {
      return NextResponse.json(
        { error: `decision_maker must be one of: ${DECISION_MAKER_VALUES.join(', ')}` },
        { status: 400 }
      )
    }

    // Editing a phone number is the other way two leads can end up sharing
    // one — the Add Lead form is guarded, but nothing stopped someone
    // retyping an existing parent's number onto a different record here.
    if ('whatsapp_number' in body && body.whatsapp_number) {
      const normalized = normalizePhone(String(body.whatsapp_number))
      if (normalized !== normalizePhone(String(existing.whatsapp_number || ''))) {
        const clash = await query(
          `SELECT id, lead_number, full_name FROM leads WHERE normalized_phone = $1 AND id <> $2 LIMIT 1`,
          [normalized, params.id]
        ).catch(() => [])
        if (clash[0]) {
          return NextResponse.json(
            {
              error: `That phone number already belongs to lead #${clash[0].lead_number} — ${clash[0].full_name}.`,
              duplicate: true,
              lead: clash[0],
            },
            { status: 409 }
          )
        }
      }
    }

    const setClauses: string[] = []
    const values: any[] = []
    const changes: string[] = []

    for (const field of fieldUpdates) {
      const newValue = body[field] === '' ? null : body[field]
      if (newValue !== existing[field]) {
        values.push(newValue)
        setClauses.push(`${field} = $${values.length}`)
        changes.push(`${FIELD_LABEL[field]}: "${existing[field] ?? '—'}" → "${newValue ?? '—'}"`)
      }
    }

    if (setClauses.length > 0) {
      values.push(params.id)
      let rows
      try {
        rows = await query(
          `UPDATE leads SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`,
          values
        )
      } catch (err: any) {
        // Backstop for the check above losing a race with a concurrent edit.
        if (err?.code === '23505' && String(err?.constraint || '').includes('normalized_phone')) {
          return NextResponse.json(
            { error: 'Another lead already has that phone number.', duplicate: true },
            { status: 409 }
          )
        }
        throw err
      }
      updated = rows[0]

      await query(
        `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id)
         VALUES ($1, 'system', 'Lead Info Updated', $2, $3)`,
        [params.id, changes.join('; '), session.id]
      )
    }
  }

  // Institute-defined custom field values — merged into the JSONB column
  // rather than replaced wholesale, so a save from a stale form doesn't
  // clobber values for fields the user's screen didn't render.
  if (body.customFields && typeof body.customFields === 'object') {
    const merged = { ...(existing.custom_fields || {}), ...body.customFields }
    const rows = await query('UPDATE leads SET custom_fields = $1 WHERE id = $2 RETURNING *', [
      JSON.stringify(merged),
      params.id,
    ])
    updated = rows[0]
  }

  return NextResponse.json(updated)
}
