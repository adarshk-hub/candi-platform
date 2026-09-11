// path: app/api/clients/[id]/email-logo/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { queryAsClient } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { canCustomize } from '@/lib/customizeAccess'

// 300 KB. A logo in an email is displayed at about 160px wide, so anything
// larger is a photo someone hasn't resized — and every recipient's client
// downloads it on open.
const MAX_BYTES = 300 * 1024

const ALLOWED = ['image/png', 'image/jpeg', 'image/gif']

// Serves the logo to email clients. Deliberately public and unauthenticated:
// the image is fetched by Gmail, Outlook and the rest on the recipient's
// behalf, and none of them carries a session cookie.
//
// It returns only this one column, so being public exposes nothing beyond
// the logo the institute is already putting in every email it sends.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const [row] = await queryAsClient<{ email_logo_data: string | null; email_logo_mime: string | null }>(
      params.id,
      'SELECT email_logo_data, email_logo_mime FROM clients WHERE id = $1',
      [params.id]
    )
    if (!row?.email_logo_data) return new NextResponse(null, { status: 404 })

    const bytes = Buffer.from(row.email_logo_data, 'base64')
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': row.email_logo_mime || 'image/png',
        // Cached hard: a logo changes once a year at most, and an email sent
        // to 3,000 parents would otherwise mean 3,000 database reads as
        // they open it.
        'Cache-Control': 'public, max-age=86400, s-maxage=604800',
      },
    })
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!canCustomize(session, params.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || !(file instanceof File)) return NextResponse.json({ error: 'No file received.' }, { status: 400 })

  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: 'Use a PNG, JPG or GIF.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${Math.round(file.size / 1024)} KB. Keep the logo under 300 KB.` },
      { status: 413 }
    )
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  await queryAsClient(
    params.id,
    `UPDATE clients SET email_logo_data = $1, email_logo_mime = $2, email_logo_updated_at = now() WHERE id = $3`,
    [base64, file.type, params.id]
  )

  return NextResponse.json({ ok: true, size: file.size })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!canCustomize(session, params.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await queryAsClient(
    params.id,
    `UPDATE clients SET email_logo_data = NULL, email_logo_mime = NULL, email_logo_updated_at = NULL WHERE id = $1`,
    [params.id]
  )
  return NextResponse.json({ ok: true })
}
