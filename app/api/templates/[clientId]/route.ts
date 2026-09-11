// path: app/api/templates/[clientId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { canCustomize } from '@/lib/customizeAccess'

export async function GET(req: NextRequest, { params }: { params: { clientId: string } }) {
  const session = getSession(req)
  if (!canCustomize(session, params.clientId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = await query(
    `SELECT id, meta_template_id, name, category, language, status, rejection_reason, submitted_at, approved_at
     FROM wa_templates WHERE client_id = $1 ORDER BY submitted_at DESC`,
    [params.clientId]
  )
  return NextResponse.json(rows)
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
