// path: app/api/lead-table-columns/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { resolveLeadColumns } from '@/lib/leadTableColumns'

// Read-only view of the institute's column selection, for the leads table.
// Separate from GET /api/clients/[id], which is gated behind canCustomize —
// a counsellor must render the same columns as everyone else without being
// able to see the rest of the institute's configuration.
export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!session.clientId) return NextResponse.json({ columns: resolveLeadColumns(null) })

  try {
    const row = (
      await query<{ lead_table_columns: string[] | null }>(
        'SELECT lead_table_columns FROM clients WHERE id = $1',
        [session.clientId]
      )
    )[0]
    return NextResponse.json({ columns: resolveLeadColumns(row?.lead_table_columns) })
  } catch (err) {
    // Migration not run yet — fall back to the default set rather than
    // leaving the leads table with no columns at all.
    console.error('[lead-table-columns] read failed:', err)
    return NextResponse.json({ columns: resolveLeadColumns(null) })
  }
}
