import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession, AGENCY_ROLES } from '@/lib/auth'
import { normalizePhone } from '@/lib/leadIntake'
import { SOURCE_LABEL } from '@/lib/types'
import { parseLeadsImportFile, IMPORT_MISSING_REQUIRED_MESSAGE } from '@/lib/leadImportExport'

const MAX_BYTES = 10 * 1024 * 1024 // 10MB is comfortably more than any real lead sheet
const MAX_ROWS = 10000

const VALID_TIMELINES = new Set(['this_year', 'next_year', 'exploring'])

// Turns a typed-in source value (label like "Facebook", a raw key like
// "facebook", or free text an institute uses that isn't in the standard
// list at all) into a value that's safe to store in leads.source, which is
// unconstrained free text in the DB.
function resolveSource(raw: string | null): string {
  if (!raw) return 'manual'
  const trimmed = raw.trim()
  if (!trimmed) return 'manual'
  const lower = trimmed.toLowerCase()
  if (SOURCE_LABEL[lower]) return lower
  const byLabel = Object.entries(SOURCE_LABEL).find(([, label]) => label.toLowerCase() === lower)
  if (byLabel) return byLabel[0]
  return trimmed
}

interface SkippedRow {
  row: number
  reason: string
}

export async function POST(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File is too large (10MB max).' }, { status: 400 })
  }

  const clientId = AGENCY_ROLES.includes(session.role) ? String(form?.get('clientId') || '') : session.clientId
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  if (session.role === 'client_admin' && clientId !== session.clientId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let parsedRows
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    parsedRows = parseLeadsImportFile(buffer)
  } catch (err) {
    console.error('[leads/import] failed to parse file', err)
    return NextResponse.json(
      { error: 'Could not read that file. Please upload a valid .xlsx, .xls or .csv file.' },
      { status: 400 }
    )
  }

  if (parsedRows.length === 0) {
    return NextResponse.json({ error: 'No rows found in that file.' }, { status: 400 })
  }
  if (parsedRows.length > MAX_ROWS) {
    return NextResponse.json({ error: `That file has more than ${MAX_ROWS} rows — please split it into smaller batches.` }, { status: 400 })
  }

  // Assigned counsellor: a counsellor importing leads always ends up owning
  // them (mirrors POST /api/leads' manual "Add Lead" behavior); other
  // roles' imports are unassigned by default.
  const assignedCounsellorId = session.role === 'client_counsellor' ? session.id : null

  const stageRows = await query<{ key: string; label: string }>(
    `SELECT key, label FROM pipeline_stages WHERE client_id = $1`,
    [clientId]
  )
  const stageByAlias = new Map<string, string>()
  for (const s of stageRows) {
    stageByAlias.set(s.key.toLowerCase(), s.key)
    stageByAlias.set(s.label.toLowerCase(), s.key)
  }

  const skipped: SkippedRow[] = []
  let imported = 0

  for (const row of parsedRows) {
    // The one hard requirement: parent name AND phone number must both be
    // present, or the row is skipped entirely rather than partially
    // imported with missing contact info.
    if (!row.fullName || !row.whatsappNumber) {
      skipped.push({ row: row.rowNumber, reason: IMPORT_MISSING_REQUIRED_MESSAGE })
      continue
    }

    const normalizedPhone = normalizePhone(row.whatsappNumber)
    if (!normalizedPhone) {
      skipped.push({ row: row.rowNumber, reason: 'Phone number did not contain any digits.' })
      continue
    }

    const resolvedStageKey = row.stageText ? stageByAlias.get(row.stageText.trim().toLowerCase()) : undefined
    const resolvedTimeline = row.stageText && VALID_TIMELINES.has(row.stageText.trim().toLowerCase())
      ? row.stageText.trim().toLowerCase()
      : null

    try {
      const rows = await query(
        `INSERT INTO leads (
          client_id, full_name, child_name, whatsapp_number, second_phone, email,
          occupation, company_name, location, grade, service_interested_in,
          source, timeline, key_concern, entry_type, assigned_counsellor_id
          ${resolvedStageKey ? ', pipeline_stage' : ''}
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'import',$15
          ${resolvedStageKey ? ',$16' : ''}
        )
        RETURNING id`,
        [
          clientId,
          row.fullName,
          row.childName,
          row.whatsappNumber,
          row.secondPhone,
          row.email,
          row.occupation,
          row.companyName,
          row.location,
          row.grade,
          row.serviceInterestedIn,
          resolveSource(row.source),
          resolvedTimeline,
          row.keyConcern,
          assignedCounsellorId,
          ...(resolvedStageKey ? [resolvedStageKey] : []),
        ]
      )
      const lead = rows[0]
      await query(
        `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id)
         VALUES ($1, 'system', 'Lead Created', $2, $3)`,
        [lead.id, `Lead imported from spreadsheet: ${row.fullName} - ${row.whatsappNumber}.`, session.id]
      )
      imported++
    } catch (err: any) {
      if (err?.code === '23505') {
        skipped.push({ row: row.rowNumber, reason: 'A lead with this phone number already exists — skipped as a duplicate.' })
      } else {
        console.error('[leads/import] insert failed for row', row.rowNumber, err)
        skipped.push({ row: row.rowNumber, reason: 'Could not be imported due to an unexpected error.' })
      }
    }
  }

  return NextResponse.json({
    imported,
    skippedCount: skipped.length,
    skipped: skipped.slice(0, 200), // cap the detail list; the count above is always accurate
    total: parsedRows.length,
    message:
      skipped.length > 0
        ? `Imported ${imported} of ${parsedRows.length} leads. ${skipped.length} row(s) were skipped because parent name and phone number are both required — rows missing either (or duplicating an existing phone number) were not imported.`
        : `Imported ${imported} of ${parsedRows.length} leads.`,
  })
}
