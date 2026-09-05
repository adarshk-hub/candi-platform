// path: app/api/clients/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query, centralQuery } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { canCustomize } from '@/lib/customizeAccess'
import { handleWriteError } from '@/lib/apiError'
import { logSettingsActivity } from '@/lib/settingsActivityLog'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!canCustomize(session, params.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = await query(
    `SELECT id, name, leads_per_page, show_lead_status_tabs,
            school_email, email_from_name, smtp_host, smtp_port, smtp_user,
            (smtp_pass IS NOT NULL AND smtp_pass != '') AS smtp_pass_set,
            meta_ad_account_id, meta_page_id
     FROM clients WHERE id = $1`,
    [params.id]
  )
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rows[0])
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!canCustomize(session, params.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const setClauses: string[] = []
  const values: any[] = []

  if (body.leadsPerPage !== undefined) {
    const n = Number(body.leadsPerPage)
    if (!Number.isFinite(n) || n < 10 || n > 1000) {
      return NextResponse.json({ error: 'leadsPerPage must be between 10 and 1000' }, { status: 400 })
    }
    values.push(n)
    setClauses.push(`leads_per_page = $${values.length}`)
  }
  if (body.showLeadStatusTabs !== undefined) {
    values.push(!!body.showLeadStatusTabs)
    setClauses.push(`show_lead_status_tabs = $${values.length}`)
  }
  if (body.schoolEmail !== undefined) {
    values.push(body.schoolEmail || null)
    setClauses.push(`school_email = $${values.length}`)
  }
  if (body.emailFromName !== undefined) {
    values.push(body.emailFromName || null)
    setClauses.push(`email_from_name = $${values.length}`)
  }
  if (body.smtpHost !== undefined) {
    values.push(body.smtpHost || null)
    setClauses.push(`smtp_host = $${values.length}`)
  }
  if (body.smtpPort !== undefined) {
    const n = body.smtpPort ? Number(body.smtpPort) : null
    if (n !== null && (!Number.isFinite(n) || n < 1 || n > 65535)) {
      return NextResponse.json({ error: 'smtpPort must be a valid port number' }, { status: 400 })
    }
    values.push(n)
    setClauses.push(`smtp_port = $${values.length}`)
  }
  if (body.smtpUser !== undefined) {
    values.push(body.smtpUser || null)
    setClauses.push(`smtp_user = $${values.length}`)
  }
  if (body.smtpPass !== undefined) {
    values.push(body.smtpPass || null)
    setClauses.push(`smtp_pass = $${values.length}`)
  }
  if (body.metaAdAccountId !== undefined) {
    values.push(body.metaAdAccountId || null)
    setClauses.push(`meta_ad_account_id = $${values.length}`)
  }
  if (body.metaPageId !== undefined) {
    values.push(body.metaPageId || null)
    setClauses.push(`meta_page_id = $${values.length}`)
  }
  if (setClauses.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  try {
    values.push(params.id)
    const rows = await query(
      `UPDATE clients SET ${setClauses.join(', ')} WHERE id = $${values.length}
       RETURNING id, name, leads_per_page, show_lead_status_tabs,
                 school_email, email_from_name, smtp_host, smtp_port, smtp_user,
                 (smtp_pass IS NOT NULL AND smtp_pass != '') AS smtp_pass_set,
                 meta_ad_account_id, meta_page_id`,
      values
    )

    // This route covers several different Settings sections in one PATCH —
    // log one activity entry per section actually touched, rather than one
    // vague "Updated client" line, so the Activity tab stays meaningful.
    const SECTION_FIELDS: Record<string, string[]> = {
      'Display Preferences': ['leadsPerPage', 'showLeadStatusTabs'],
      'School Email': ['schoolEmail', 'emailFromName', 'smtpHost', 'smtpPort', 'smtpUser', 'smtpPass'],
      'Ad Account Connection': ['metaAdAccountId', 'metaPageId'],
    }
    for (const [section, fields] of Object.entries(SECTION_FIELDS)) {
      const touched = fields.filter((f) => body[f] !== undefined)
      if (touched.length === 0) continue
      const described = touched.includes('smtpPass') ? touched.filter((f) => f !== 'smtpPass').concat(['smtpPass']) : touched
      await logSettingsActivity(params.id, session, section, `Updated ${described.join(', ')}`)
    }

    // Webhook routing (which institute does this Meta Page ID / ad account
    // belong to?) reads from the central registry, not any one client's own
    // database — see lib/db.ts and the meta-leads webhook. Mirror these two
    // specific fields there whenever they change, so a Settings save here
    // actually takes effect for incoming webhooks and the spend-sync cron,
    // not just for what this one client's own database shows back.
    if (body.metaPageId !== undefined || body.metaAdAccountId !== undefined) {
      const centralSet: string[] = []
      const centralValues: any[] = []
      if (body.metaPageId !== undefined) {
        centralValues.push(body.metaPageId || null)
        centralSet.push(`meta_page_id = $${centralValues.length}`)
      }
      if (body.metaAdAccountId !== undefined) {
        centralValues.push(body.metaAdAccountId || null)
        centralSet.push(`meta_ad_account_id = $${centralValues.length}`)
      }
      centralValues.push(params.id)
      await centralQuery(`UPDATE clients SET ${centralSet.join(', ')} WHERE id = $${centralValues.length}`, centralValues)
    }

    return NextResponse.json(rows[0])
  } catch (err: any) {
    return handleWriteError(err)
  }
}
