import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { canCustomize } from '@/lib/customizeAccess'
import { handleWriteError } from '@/lib/apiError'
import { logSettingsActivity } from '@/lib/settingsActivityLog'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  const existing = (await query('SELECT * FROM lead_form_fields WHERE id = $1', [params.id]))[0]
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canCustomize(session, existing.client_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const setClauses: string[] = []
  const values: any[] = []
  if (body.label !== undefined) {
    values.push(body.label)
    setClauses.push(`label = $${values.length}`)
  }
  if (body.fieldType !== undefined) {
    values.push(body.fieldType)
    setClauses.push(`field_type = $${values.length}`)
  }
  if (body.options !== undefined) {
    values.push(JSON.stringify(body.options))
    setClauses.push(`options = $${values.length}`)
  }
  if (body.isActive !== undefined) {
    values.push(body.isActive)
    setClauses.push(`is_active = $${values.length}`)
  }
  if (body.sortOrder !== undefined) {
    values.push(body.sortOrder)
    setClauses.push(`sort_order = $${values.length}`)
  }
  if (setClauses.length === 0) return NextResponse.json(existing)

  try {
    values.push(params.id)
    const rows = await query(
      `UPDATE lead_form_fields SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    )
    await logSettingsActivity(
      existing.client_id,
      session,
      'Lead Form Fields',
      `Updated field "${existing.label}" — changed ${Object.keys(body).join(', ')}`
    )
    return NextResponse.json(rows[0])
  } catch (err: any) {
    return handleWriteError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  const existing = (await query('SELECT * FROM lead_form_fields WHERE id = $1', [params.id]))[0]
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canCustomize(session, existing.client_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await query('DELETE FROM lead_form_fields WHERE id = $1', [params.id])
  await logSettingsActivity(existing.client_id, session, 'Lead Form Fields', `Deleted field "${existing.label}"`)
  return NextResponse.json({ ok: true })
}
