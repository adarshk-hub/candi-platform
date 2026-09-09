// path: app/api/my-day/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { handleWriteError } from '@/lib/apiError'

// Ownership is checked on the row itself rather than trusting the id in the
// URL — these are personal notes, and a manager who can read someone's day
// still has no business editing it.
async function ownNote(userId: string, id: string) {
  const rows = await query('SELECT * FROM day_notes WHERE id = $1 AND user_id = $2', [id, userId])
  return rows[0] || null
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const note = await ownNote(session.id, params.id)
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const setClauses: string[] = []
  const values: any[] = []

  if (body.isDone !== undefined) {
    values.push(!!body.isDone)
    setClauses.push(`is_done = $${values.length}`)
  }
  if (body.title !== undefined && String(body.title).trim()) {
    values.push(String(body.title).trim())
    setClauses.push(`title = $${values.length}`)
  }
  if (body.details !== undefined) {
    values.push(body.details || null)
    setClauses.push(`details = $${values.length}`)
  }
  if (setClauses.length === 0) return NextResponse.json(note)

  try {
    values.push(params.id)
    const rows = await query(
      `UPDATE day_notes SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    )
    return NextResponse.json(rows[0])
  } catch (err: any) {
    return handleWriteError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const note = await ownNote(session.id, params.id)
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await query('DELETE FROM day_notes WHERE id = $1', [params.id])
  return NextResponse.json({ ok: true })
}
