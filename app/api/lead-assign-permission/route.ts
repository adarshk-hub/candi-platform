// path: app/api/lead-assign-permission/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { canAssignLeads } from '@/lib/assignPermission'

// One question, asked by the lead panel and the leads-list bulk bar: may
// this login hand a lead to somebody else? Admins always can; counsellors
// only where the institute has turned it on.
export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ canAssign: false }, { status: 401 })
  return NextResponse.json({ canAssign: await canAssignLeads(session) })
}
