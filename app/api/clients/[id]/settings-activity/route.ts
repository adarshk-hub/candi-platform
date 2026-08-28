import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { canCustomize } from '@/lib/customizeAccess'

const PAGE_SIZE = 50

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!canCustomize(session, params.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1)
  const offset = (page - 1) * PAGE_SIZE

  const [{ count }] = await query<{ count: string }>(
    'SELECT COUNT(*)::int AS count FROM settings_activity_log WHERE client_id = $1',
    [params.id]
  )

  const rows = await query(
    `SELECT id, user_name, section, description, created_at
     FROM settings_activity_log
     WHERE client_id = $1
     ORDER BY created_at DESC
     LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    [params.id]
  )

  return NextResponse.json({ entries: rows, total: Number(count), page, pageSize: PAGE_SIZE })
}
