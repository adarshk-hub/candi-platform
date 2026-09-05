// path: app/api/lead-date-range/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getLeadDateRange } from '@/lib/leadDateRange'

// Read-only view of the global window for any signed-in user, so client
// components can clamp their own date inputs. Deliberately separate from
// GET /api/clients/[id], which is gated behind canCustomize — a counsellor
// needs to know the bounds of their own Follow Up filter without being
// able to see (or edit) the rest of the institute's configuration.
export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!session.clientId) return NextResponse.json({ from: null, to: null })

  return NextResponse.json(await getLeadDateRange(session.clientId))
}
