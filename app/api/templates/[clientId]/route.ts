// path: app/api/templates/[clientId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { canCustomize } from '@/lib/customizeAccess'
import { ensureVariableMapColumn, hasVariableMapColumn, normalizeVariableMap } from '@/lib/templateVariables'

export async function GET(req: NextRequest, { params }: { params: { clientId: string } }) {
  const session = getSession(req)
  if (!canCustomize(session, params.clientId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const hasColumn = await hasVariableMapColumn()
  const rows = await query<any>(
    `SELECT id, meta_template_id, name, category, language, status, rejection_reason, submitted_at, approved_at, components,
            ${hasColumn ? 'variable_map' : 'NULL AS variable_map'}
     FROM wa_templates WHERE client_id = $1 ORDER BY submitted_at DESC`,
    [params.clientId]
  )
  // Surface the template's body text so Settings can show what the
  // message actually says, alongside its status notes.
  const withBody = rows.map(({ components, ...row }: any) => {
    const list = Array.isArray(components) ? components : []
    const bodyComponent = list.find((c: any) => String(c?.type || '').toUpperCase() === 'BODY')
    return { ...row, body_text: bodyComponent?.text || null }
  })
  return NextResponse.json(withBody)
}

// Deletes a template record.
//
// Only rejected ones. An approved template may be referenced by a nurture
// step or a scheduled broadcast, and removing it would leave those pointing
// at nothing — whereas a rejected template can never be sent, so the row is
// pure clutter in a list people have to read.
//
// This removes the local record, not anything at Meta. Meta keeps its own
// copy of a rejected submission; resubmitting the same name later is
// handled on their side.
export async function DELETE(req: NextRequest, { params }: { params: { clientId: string } }) {
  const session = getSession(req)
  if (!canCustomize(session, params.clientId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  const all = req.nextUrl.searchParams.get('all') === 'rejected'

  if (all) {
    const rows = await query(
      `DELETE FROM wa_templates WHERE client_id = $1 AND status = 'rejected' RETURNING id`,
      [params.clientId]
    )
    return NextResponse.json({ deleted: rows.length })
  }

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const rows = await query(
    `DELETE FROM wa_templates WHERE id = $1 AND client_id = $2 AND status = 'rejected' RETURNING id`,
    [id, params.clientId]
  )
  if (!rows[0]) {
    return NextResponse.json(
      { error: 'Only rejected templates can be removed — an approved one may be in use by a sequence step.' },
      { status: 400 }
    )
  }
  return NextResponse.json({ deleted: 1 })
}

// Updates what each {{n}} variable in a template is filled with. The mapping
// lives only on our side — Meta approved the body text, not the meaning of
// its placeholders — so it can be changed at any time, including after
// approval, without resubmitting anything.
export async function PATCH(req: NextRequest, { params }: { params: { clientId: string } }) {
  const session = getSession(req)
  if (!canCustomize(session, params.clientId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const id = body?.id
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  // Each client has its own database, so the column may simply not exist
  // here yet — create it rather than making someone run a migration per
  // client before a mapping can be saved.
  if (!(await ensureVariableMapColumn())) {
    return NextResponse.json(
      { error: 'Could not add the variable_map column to this client database — check the database user\'s permissions.' },
      { status: 500 }
    )
  }

  const row = (
    await query<any>(
      `UPDATE wa_templates SET variable_map = $1 WHERE id = $2 AND client_id = $3 RETURNING id, variable_map`,
      [JSON.stringify(normalizeVariableMap(body?.variableMap)), id, params.clientId]
    )
  )[0]
  if (!row) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  return NextResponse.json(row)
}
