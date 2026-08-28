import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { buildLeadsExportFile, ExportableLead, ExportFormat } from '@/lib/leadImportExport'

// Shares the exact same filter semantics as GET /api/leads (search, tab,
// stage/source/grade) so "export what I'm looking at" always matches what's
// on screen — but exports every matching row, not just the current page,
// unless the caller passed a specific set of selected ids.
export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const format = (sp.get('format') === 'csv' ? 'csv' : 'xlsx') as ExportFormat
  const search = sp.get('search')?.trim() || ''
  const tab = sp.get('tab') || ''
  const idsParam = (sp.get('ids') || '').split(',').map((v) => v.trim()).filter(Boolean)
  const stageFilter = (sp.get('stage') || '').split(',').map((v) => v.trim()).filter(Boolean)
  const sourceFilter = (sp.get('source') || '').split(',').map((v) => v.trim()).filter(Boolean)
  const gradeFilter = (sp.get('grade') || '').split(',').map((v) => v.trim()).filter(Boolean)

  const where: string[] = []
  const params: any[] = []

  if (session.role === 'client_admin') {
    params.push(session.clientId)
    where.push(`l.client_id = $${params.length}`)
  } else if (session.role === 'client_counsellor') {
    params.push(session.id)
    where.push(`l.assigned_counsellor_id = $${params.length}`)
  }

  if (idsParam.length > 0) {
    params.push(idsParam)
    where.push(`l.id = ANY($${params.length})`)
  } else {
    if (search) {
      params.push(`%${search}%`)
      const i = params.length
      where.push(`(l.full_name ILIKE $${i} OR l.child_name ILIKE $${i} OR l.whatsapp_number ILIKE $${i})`)
    }
    if (stageFilter.length > 0) {
      params.push(stageFilter)
      where.push(`l.pipeline_stage = ANY($${params.length})`)
    }
    if (sourceFilter.length > 0) {
      params.push(sourceFilter)
      where.push(`l.source = ANY($${params.length})`)
    }
    if (gradeFilter.length > 0) {
      params.push(gradeFilter)
      where.push(`l.grade = ANY($${params.length})`)
    }
    if (tab === 'enrolled') {
      where.push(
        `EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.client_id = l.client_id AND ps.key = l.pipeline_stage AND ps.status_group = 'won')`
      )
    } else if (tab === 'hot') {
      where.push(
        `EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.client_id = l.client_id AND ps.key = l.pipeline_stage AND ps.status_group = 'hot')`
      )
    } else if (tab === 'warm') {
      where.push(
        `EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.client_id = l.client_id AND ps.key = l.pipeline_stage AND ps.status_group = 'warm')`
      )
    } else if (tab === 'cold') {
      where.push(
        `EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.client_id = l.client_id AND ps.key = l.pipeline_stage AND ps.status_group = 'cold')`
      )
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  // Capped so an "export everything, no filters" click on a very large
  // institute can't build an unbounded file in memory; this comfortably
  // covers any real school's lead volume.
  const EXPORT_CAP = 50000
  const rows = await query<ExportableLead & { pipeline_stage: string; client_id: string }>(
    `SELECT l.lead_number, l.full_name, l.child_name, l.whatsapp_number, l.second_phone, l.email,
            l.grade, l.source, l.pipeline_stage, l.client_id, l.created_at,
            COALESCE(ps.label, l.pipeline_stage) AS stage_label,
            u.full_name AS counsellor_name
     FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_counsellor_id
     LEFT JOIN pipeline_stages ps ON ps.client_id = l.client_id AND ps.key = l.pipeline_stage
     ${whereSql}
     ORDER BY l.created_at DESC
     LIMIT ${EXPORT_CAP}`,
    params
  )

  const { buffer, contentType, extension } = buildLeadsExportFile(rows, format)
  const filename = `leads-export-${new Date().toISOString().slice(0, 10)}.${extension}`

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    },
  })
}
