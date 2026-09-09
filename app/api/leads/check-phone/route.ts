// path: app/api/leads/check-phone/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { normalizePhone } from '@/lib/leadIntake'

// Lets the Add Lead form (and the Info tab's phone edit) tell someone the
// number is already on file *while they're typing it*, rather than after
// they've filled in the whole form and pressed Save. The POST/PATCH routes
// still enforce this independently — this endpoint is a courtesy, not the
// guard.
export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const phone = sp.get('phone')?.trim() || ''
  const excludeLeadId = sp.get('excludeLeadId')?.trim() || ''

  const normalized = normalizePhone(phone)
  // Fewer than 10 digits isn't a number anyone finished typing yet — report
  // "no duplicate" instead of matching a partial string against everything.
  if (normalized.length < 10) return NextResponse.json({ duplicate: false, lead: null })

  const params: any[] = [normalized]
  let sql = `SELECT l.id, l.lead_number, l.full_name, l.whatsapp_number, l.pipeline_stage, l.created_at,
                    u.full_name AS counsellor_name
             FROM leads l
             LEFT JOIN users u ON u.id = l.assigned_counsellor_id
             WHERE l.normalized_phone = $1`

  if (excludeLeadId) {
    params.push(excludeLeadId)
    sql += ` AND l.id <> $${params.length}`
  }
  sql += ' ORDER BY l.created_at ASC LIMIT 1'

  try {
    const rows = await query(sql, params)
    return NextResponse.json({ duplicate: !!rows[0], lead: rows[0] || null })
  } catch (err: any) {
    // Never block the form on a lookup failure — the write path checks again
    // and the unique index is the real backstop.
    console.error('[check-phone] failed:', err)
    return NextResponse.json({ duplicate: false, lead: null })
  }
}
