import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { canCustomize } from '@/lib/customizeAccess'
import { decrypt } from '@/lib/waEncryption'

const GRAPH_API_URL = process.env.META_GRAPH_API_URL || 'https://graph.facebook.com/v19.0'

// Same appsecret_proof requirement as lib/metaWhatsapp.ts — this route
// calls the Graph API directly rather than through that shared client, so
// it needs its own copy of the proof calculation. See metaWhatsapp.ts for
// the full explanation of why this exists.
function appSecretProof(accessToken: string): string {
  const appSecret = process.env.META_APP_SECRET
  if (!appSecret) return ''
  return crypto.createHmac('sha256', appSecret).update(accessToken).digest('hex')
}

// Polls Meta for the current status of every template still marked
// 'pending' for this client and updates wa_templates accordingly. Meta
// doesn't push a webhook event for template approval by default, so this
// has to be polled — call it from a settings-page "Refresh status" button
// or a periodic cron, same idea as the wa-sequence-advance job.
export async function POST(req: NextRequest, { params }: { params: { clientId: string } }) {
  try {
    const session = getSession(req)
    if (!canCustomize(session, params.clientId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const config = (
      await query('SELECT waba_id, access_token FROM wa_client_config WHERE client_id = $1', [params.clientId])
    )[0]
    if (!config) return NextResponse.json({ error: 'No WhatsApp config saved for this client yet' }, { status: 400 })

    // Re-checks every template against Meta, not just ones still marked
    // 'pending' — an already-approved template's category can still
    // change later (Meta reclassifies independently of approval status),
    // and the only way to catch that after the fact — rather than relying
    // on a webhook event that may have fired before this app was even
    // listening for it — is to just ask Meta what it currently says,
    // every time this button is clicked.
    const allTemplates = await query(
      `SELECT id, name FROM wa_templates WHERE client_id = $1`,
      [params.clientId]
    )

    const accessToken = decrypt(config.access_token)
    const updated: any[] = []
    const errors: any[] = []

    for (const tmpl of allTemplates) {
      const proof = appSecretProof(accessToken)
      const res = await fetch(
        `${GRAPH_API_URL}/${config.waba_id}/message_templates?name=${encodeURIComponent(tmpl.name)}${proof ? `&appsecret_proof=${proof}` : ''}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        // Meta rejected the request itself (bad/expired token, wrong
        // permissions, wrong WABA ID, etc.) — surface this instead of
        // silently leaving the template stuck at 'pending' forever with no
        // indication anything went wrong.
        errors.push({ id: tmpl.id, name: tmpl.name, httpStatus: res.status, metaError: data?.error || data })
        continue
      }

      const match = data?.data?.[0]
      if (!match) {
        // Request succeeded but Meta has no template by this exact name on
        // this WABA — usually means it was deleted/renamed directly in
        // WhatsApp Manager, or belongs to a different WABA than the one
        // currently configured.
        errors.push({ id: tmpl.id, name: tmpl.name, reason: 'No template with this name found on Meta for this WABA' })
        continue
      }

      const newStatus = String(match.status || 'pending').toLowerCase()
      const rejectionReason = match.rejected_reason || null
      const newCategory = match.category ? String(match.category).toUpperCase() : null

      await query(
        `UPDATE wa_templates
         SET status = $1::varchar, rejection_reason = $2,
             category = COALESCE($3, category),
             -- Only stamp approved_at when status is *becoming* approved
             -- (it wasn't already), not every time an already-approved
             -- template gets re-confirmed as still approved — now that
             -- this route re-checks every template, not just pending
             -- ones, re-running it would otherwise reset approved_at to
             -- "just now" on every click, wiping out the real approval
             -- date.
             approved_at = CASE WHEN $1::varchar = 'approved' AND status != 'approved' THEN now() ELSE approved_at END
         WHERE id = $4`,
        [newStatus, rejectionReason, newCategory, tmpl.id]
      )
      updated.push({ id: tmpl.id, name: tmpl.name, status: newStatus, category: newCategory, metaStatusRaw: match.status })
    }

    // A template can exist at Meta without a row here — submitted from
    // WhatsApp Manager directly, or submitted from this app in a run where
    // the local insert failed after Meta had already accepted it. Either
    // way it is real and sendable, so this pulls those in rather than
    // leaving the list saying "no templates submitted yet".
    const imported: any[] = []
    try {
      const proof = appSecretProof(accessToken)
      const listRes = await fetch(
        `${GRAPH_API_URL}/${config.waba_id}/message_templates?limit=200${proof ? `&appsecret_proof=${proof}` : ''}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const listData = await listRes.json().catch(() => ({}))
      if (listRes.ok && Array.isArray(listData?.data)) {
        const known = new Set(allTemplates.map((t: any) => t.name))
        for (const remote of listData.data) {
          if (!remote?.name || known.has(remote.name)) continue
          const status = String(remote.status || 'pending').toLowerCase()
          const row = (
            await query(
              `INSERT INTO wa_templates (client_id, meta_template_id, name, category, language, status, rejection_reason, components, approved_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $6::varchar = 'approved' THEN now() ELSE NULL END)
               ON CONFLICT (client_id, name) DO NOTHING
               RETURNING id, name, status`,
              [
                params.clientId,
                remote.id || null,
                remote.name,
                remote.category ? String(remote.category).toUpperCase() : 'UTILITY',
                remote.language || 'en',
                ['approved', 'pending', 'rejected'].includes(status) ? status : 'pending',
                remote.rejected_reason || null,
                JSON.stringify(remote.components || []),
              ]
            )
          )[0]
          if (row) imported.push(row)
        }
      }
    } catch (err: any) {
      errors.push({ reason: `Could not list templates from Meta: ${err?.message || 'unknown error'}` })
    }

    return NextResponse.json({ ok: true, updated, imported, errors })
  } catch (err: any) {
    // Whatever broke (decrypt failure from a corrupted/mismatched
    // encryption key, a DB error, a thrown network error, etc.) — return
    // the real message instead of Next.js's generic opaque 500, since an
    // unhandled throw here previously surfaced to the UI as a useless
    // "Could not check template availability with Meta" with zero
    // indication of the actual cause.
    console.error('[templates/sync] failed:', err)
    return NextResponse.json({ error: err?.message || 'Unexpected server error during template sync' }, { status: 500 })
  }
}
