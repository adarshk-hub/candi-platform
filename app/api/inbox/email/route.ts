// path: app/api/inbox/email/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { sendEmail } from '@/lib/email'
import { handleWriteError } from '@/lib/apiError'

const PAGE_SIZE = 50

// 2 MB across all attachments on one message. Chosen to match what most
// school mailboxes and receiving servers tolerate without silently bouncing,
// and to keep the JSON request body under the platform's own limit once
// base64 has inflated it by roughly a third.
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024

// An allowlist rather than a blocklist: the things an admissions office
// actually sends are documents and photos, and anything executable has no
// business being relayed through the school's mailbox.
const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
]

// The Inbox is a shared mailbox view: everyone at the institute sees the same
// messages, the same way they would if they were all looking at the school's
// actual email account. That's the point of it — a reply that lands while the
// assigned counsellor is out shouldn't be invisible to the person covering.
export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const box = sp.get('box') === 'sent' ? 'outbound' : 'inbound'
  const search = sp.get('search')?.trim() || ''

  const params: any[] = [box]
  let where = 'WHERE em.direction = $1'
  if (search) {
    params.push(`%${search}%`)
    const i = params.length
    where += ` AND (em.subject ILIKE $${i} OR em.from_email ILIKE $${i} OR em.to_email ILIKE $${i} OR l.full_name ILIKE $${i})`
  }

  try {
    const rows = await query(
      `SELECT em.id, em.lead_id, em.direction, em.subject, em.body, em.to_email, em.from_email,
              em.status, em.is_read, em.created_at, em.received_at, em.attachments,
              l.full_name AS lead_name, l.lead_number, l.whatsapp_number,
              u.full_name AS sent_by_name
       FROM email_messages em
       LEFT JOIN leads l ON l.id = em.lead_id
       LEFT JOIN users u ON u.id = em.sent_by
       ${where}
       ORDER BY COALESCE(em.received_at, em.created_at) DESC
       LIMIT ${PAGE_SIZE}`,
      params
    )

    const [unread] = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM email_messages WHERE direction = 'inbound' AND NOT is_read`
    )

    return NextResponse.json({ rows, unread: unread?.count ?? 0 })
  } catch (err: any) {
    if (err?.code === '42703') {
      return NextResponse.json({
        migrationNeeded: true,
        rows: [],
        unread: 0,
        error: 'Run scripts/phase3-migration.sql against this database first.',
      })
    }
    console.error('[inbox:email] failed:', err)
    return NextResponse.json({ error: 'Could not load the mailbox.' }, { status: 500 })
  }
}

// Composing or replying from the Inbox. Unlike the per-lead Email tab, the
// recipient is given explicitly — a reply may go to an address that doesn't
// belong to any lead yet.
export async function POST(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const to = String(body.to || '').trim()
  const subject = String(body.subject || '').trim()
  const text = String(body.body || '').trim()
  const leadId: string | null = body.leadId || null

  if (!to || !subject || !text) {
    return NextResponse.json({ error: 'to, subject and body are all required.' }, { status: 400 })
  }

  // Validated here rather than trusting the browser: the client-side size
  // check exists to give quick feedback, not to enforce anything.
  const rawAttachments: any[] = Array.isArray(body.attachments) ? body.attachments : []
  const attachments = []
  let totalBytes = 0

  for (const a of rawAttachments) {
    if (!a?.filename || typeof a.data !== 'string') continue
    const contentType = String(a.contentType || 'application/octet-stream')
    if (!ALLOWED_TYPES.includes(contentType)) {
      return NextResponse.json(
        { error: `"${a.filename}" is a file type this mailbox won't send. Allowed: PDF, images, Word, Excel, CSV and plain text.` },
        { status: 400 }
      )
    }
    // Length of the decoded file, computed from the base64 string rather
    // than trusting a size the client reported alongside it.
    const bytes = Math.floor((a.data.length * 3) / 4)
    totalBytes += bytes
    if (totalBytes > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        { error: 'Attachments come to more than 2 MB in total. Remove one, or send a link instead.' },
        { status: 413 }
      )
    }
    attachments.push({ filename: String(a.filename), contentType, data: a.data, size: bytes })
  }

  const clientId = session.clientId
  const [client] = await query(
    `SELECT id, school_email, email_from_name, smtp_host, smtp_port, smtp_user, smtp_pass
     FROM clients ${clientId ? 'WHERE id = $1' : 'LIMIT 1'}`,
    clientId ? [clientId] : []
  )

  const result = await sendEmail(
    {
      host: client?.smtp_host || null,
      port: client?.smtp_port || null,
      user: client?.smtp_user || null,
      pass: client?.smtp_pass || null,
      fromEmail: client?.school_email || null,
      fromName: client?.email_from_name || null,
    },
    {
      to,
      subject,
      body: text,
      attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, data: a.data })),
    }
  )

  try {
    const rows = await query(
      `INSERT INTO email_messages
         (client_id, lead_id, direction, subject, body, to_email, from_email, status, error, sent_by, attachments)
       VALUES ($1,$2,'outbound',$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        client?.id || clientId,
        leadId,
        subject,
        text,
        to,
        client?.school_email || null,
        result.ok ? 'sent' : 'failed',
        result.error || null,
        session.id,
        // Names and sizes only — the bytes have been delivered and are not
        // worth a second copy in the database. See scripts/phase3b-attachments.sql.
        attachments.length
          ? JSON.stringify(attachments.map((a) => ({ filename: a.filename, size: a.size, contentType: a.contentType })))
          : null,
      ]
    )

    // Only leads get an activity entry — there's nowhere to file a timeline
    // note for a message to somebody who isn't in the CRM.
    if (leadId) {
      await query(
        `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id)
         VALUES ($1, 'system', 'Email Sent', $2, $3)`,
        [leadId, `"${subject}" ${result.ok ? 'sent' : 'failed to send'} to ${to} from the Inbox.`, session.id]
      )
    }

    if (!result.ok) return NextResponse.json({ error: result.error, message: rows[0] }, { status: 502 })
    return NextResponse.json(rows[0])
  } catch (err: any) {
    return handleWriteError(err)
  }
}

// Marks one message read, or all of them. Read state is shared, like the
// mailbox itself — if a colleague has already dealt with a message, it should
// stop shouting at everyone else too.
export async function PATCH(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  try {
    if (body.all) {
      await query(`UPDATE email_messages SET is_read = true WHERE direction = 'inbound' AND NOT is_read`)
    } else if (body.id) {
      await query('UPDATE email_messages SET is_read = true WHERE id = $1', [body.id])
    } else {
      return NextResponse.json({ error: 'id or all is required' }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return handleWriteError(err)
  }
}
