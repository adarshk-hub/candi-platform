// path: app/api/clients/[id]/excluded-campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { canCustomize } from '@/lib/customizeAccess'
import { getExcludedCampaignIds, setExcludedCampaignIds } from '@/lib/dashboardPrefs'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!canCustomize(session, params.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json({ excluded: await getExcludedCampaignIds(params.id) })
}

// Takes the complete excluded set, not a single toggle — see the note in
// lib/dashboardPrefs.ts on why this is a full replace.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!canCustomize(session, params.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const excluded: string[] = Array.isArray(body.excluded)
    ? body.excluded.filter((id: any) => typeof id === 'string' && id)
    : []

  try {
    await setExcludedCampaignIds(params.id, excluded)
    return NextResponse.json({ ok: true, excluded })
  } catch (err) {
    console.error('[excluded-campaigns] save failed:', err)
    return NextResponse.json({ error: 'Could not save campaign selection.' }, { status: 500 })
  }
}
