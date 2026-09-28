// path: app/api/templates/[clientId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { canCustomize } from '@/lib/customizeAccess'
import { deleteTemplateAtMeta } from '@/lib/metaWhatsapp'
import { decrypt } from '@/lib/waEncryption'
import { hasVariableMapColumn, normalizeVariableMap, saveVariableMap, variableMapFromRow } from '@/lib/templateVariables'

export async function GET(req: NextRequest, { params }: { params: { clientId: string } }) {
  const session = getSession(req)
  // Reading the list is open to anyone signed in at that institute —
  // counsellors need to see which templates are approved before they can
  // send one. Writing still goes through canCustomize below.
  const canRead =
    !!session &&
    (canCustomize(session, params.clientId) ||
      (!!session.clientId && session.clientId === params.clientId))
  if (!canRead) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const hasColumn = await hasVariableMapColumn()
  const rows = await query<any>(
    `SELECT id, meta_template_id, name, category, language, status, rejection_reason, submitted_at, approved_at, components,
            ${hasColumn ? 'variable_map' : 'NULL AS variable_map'}
     FROM wa_templates WHERE client_id = $1 ORDER BY submitted_at DESC`,
    [params.clientId]
  )
  // Surface the template's body text so Settings can show what the
  // message actually says, alongside its status notes. The mapping may live
  // in the column or, where that column could not be added, inside
  // components — variableMapFromRow reads whichever is there.
  const withBody = rows.map(({ components, ...row }: any) => {
    const list = Array.isArray(components) ? components : []
    const bodyComponent = list.find((c: any) => String(c?.type || '').toUpperCase() === 'BODY')
    return { ...row, body_text: bodyComponent?.text || null, variable_map: variableMapFromRow({ ...row, components: list }) }
  })
  return NextResponse.json(withBody)
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

  // Everything here is wrapped: an unhandled throw returns a 500 with no
  // JSON body, which the panel could only report as the generic "Could not
  // remove that template." — the actual reason is what is needed.
  try {
    const [config] = await query<{ waba_id: string; access_token: string }>(
      'SELECT waba_id, access_token FROM wa_configs WHERE client_id = $1',
      [params.clientId]
    )

    // Meta holds the real template, so it is deleted there too — otherwise
    // "Check approval status" re-imports it and it appears to come back.
    // A template Meta doesn't have (never submitted, or already deleted
    // there) must still be removable here, so that case is not an error.
    async function removeAtMeta(name: string): Promise<string | null> {
      if (!config?.waba_id || !config?.access_token) return null
      try {
        const res = await deleteTemplateAtMeta({
          wabaId: config.waba_id,
          accessToken: decrypt(config.access_token),
          name,
        })
        if (res.ok) return null
        const reason = res.error || ''
        // 100 / "does not exist" — nothing to delete at Meta's end.
        if (/does not exist|not found|Unknown/i.test(reason)) return null
        return reason
      } catch (err: any) {
        return err?.message || 'Could not reach Meta'
      }
    }

    // A template wired into the message schedule is unhooked at the same
    // time, or that step would point at something that no longer exists.
    async function clearSchedule(name: string): Promise<number[]> {
      try {
        const rows = await query<{ day_number: number }>(
          'DELETE FROM wa_sequence_templates WHERE client_id = $1 AND template_name = $2 RETURNING day_number',
          [params.clientId, name]
        )
        return rows.map((r) => r.day_number)
      } catch {
        return []
      }
    }

    if (all) {
      const rows = await query<{ id: string; name: string }>(
        `SELECT id, name FROM wa_templates WHERE client_id = $1 AND status = 'rejected'`,
        [params.clientId]
      )
      for (const row of rows) {
        await removeAtMeta(row.name)
        await clearSchedule(row.name)
      }
      await query(`DELETE FROM wa_templates WHERE client_id = $1 AND status = 'rejected'`, [params.clientId])
      return NextResponse.json({ deleted: rows.length })
    }

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const [existing] = await query<{ id: string; name: string }>(
      'SELECT id, name FROM wa_templates WHERE id = $1 AND client_id = $2',
      [id, params.clientId]
    )
    if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

    const metaError = await removeAtMeta(existing.name)
    if (metaError) {
      return NextResponse.json({ error: `Meta would not delete this template: ${metaError}` }, { status: 400 })
    }

    const clearedSteps = await clearSchedule(existing.name)
    const deleted = await query<{ id: string }>(
      'DELETE FROM wa_templates WHERE id = $1 AND client_id = $2 RETURNING id',
      [id, params.clientId]
    )
    if (!deleted[0]) {
      return NextResponse.json({ error: 'The template row could not be deleted.' }, { status: 500 })
    }

    return NextResponse.json({ deleted: 1, clearedSteps })
  } catch (err: any) {
    console.error('[templates:delete] failed:', err)
    return NextResponse.json(
      { error: err?.message ? `Delete failed: ${err.message}` : 'Delete failed for an unknown reason.' },
      { status: 500 }
    )
  }
}

// Updates what each {{n}} variable in a template is filled with. The mapping
// lives only on our side — Meta approved the body text, not the meaning of
// its placeholders — so it can be changed at any time, including after
// approval, without resubmitting anything.
export async function PATCH(req: NextRequest, { params }: { params: { clientId: string } }) {
  const session = getSession(req)
  if (!canCustomize(session, params.clientId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const id = body?.id
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const result = await saveVariableMap(params.clientId, id, normalizeVariableMap(body?.variableMap))
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || 'Could not save the variable mapping.' },
      { status: result.error === 'Template not found' ? 404 : 500 }
    )
  }
  return NextResponse.json({ id, ok: true })
}
