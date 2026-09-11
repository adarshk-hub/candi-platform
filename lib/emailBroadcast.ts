// path: lib/emailBroadcast.ts
import { query, queryAsClient, centralQuery } from './db'
import { sendEmail } from './email'
import { findPreset } from './emailBroadcastTemplates'
import { buildAudienceQuery, previewAudience as previewAudienceShared, BroadcastFilters, AudienceLead } from './leadAudience'
import { leadDateRangeSql } from './leadDateRange'

export type { BroadcastFilters, AudienceLead }

// Email broadcasts require an email on file — leads with no email are
// excluded from the audience entirely rather than queued and failed.
export async function previewAudience(
  clientId: string,
  filters: BroadcastFilters,
  sampleSize = 10
): Promise<{ count: number; sample: AudienceLead[] }> {
  return previewAudienceShared(clientId, filters, 'email', sampleSize)
}

export interface CreateEmailBroadcastParams {
  clientId: string
  name: string
  subject: string
  body: string // plain text, rendered into the chosen preset per recipient
  presetKey?: string | null
  ctaLabel?: string | null
  ctaUrl?: string | null
  filters: BroadcastFilters
  // Hand-picked recipients from the preview list. When present these win
  // over `filters` entirely — the same behaviour as WhatsApp broadcasts,
  // so unticking someone in the preview genuinely removes them rather
  // than the filters silently re-adding them at send time.
  explicitLeadIds?: string[] | null
  createdBy?: string | null
}

export async function createBroadcast(
  params: CreateEmailBroadcastParams
): Promise<{ broadcastId: string; totalRecipients: number }> {
  const { whereSql, params: audienceParams } = buildAudienceQuery(params.clientId, params.filters, 'email')

  const broadcast = (
    await query<{ id: string }>(
      `INSERT INTO email_broadcasts
         (client_id, name, subject, body, preset_key, cta_label, cta_url,
          filter_tags, filter_tags_mode, filter_stage_keys,
          filter_created_from, filter_created_to, filter_last_contacted_from, filter_last_contacted_to,
          created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [
        params.clientId,
        params.name,
        params.subject,
        params.body,
        params.presetKey || 'announcement',
        params.ctaLabel || null,
        params.ctaUrl || null,
        params.filters.tags,
        params.filters.tagsMode,
        params.filters.stageKeys,
        params.filters.createdFrom || null,
        params.filters.createdTo || null,
        params.filters.lastContactedFrom || null,
        params.filters.lastContactedTo || null,
        params.createdBy || null,
      ]
    )
  )[0]

  let inserted: { one: number }[]
  if (params.explicitLeadIds && params.explicitLeadIds.length > 0) {
    // Hand-picked audience — still scoped to this client, still requires an
    // email on file, and still held inside the global lead date range. A
    // client-supplied id list is never trusted blindly: it could name a lead
    // from another institute, one with no email, or one the date window
    // hides.
    inserted = await query<{ one: number }>(
      `WITH matched AS (
         SELECT l.id AS lead_id, l.email AS to_email
         FROM leads l
         WHERE l.client_id = $1 AND l.id = ANY($2) AND l.email IS NOT NULL AND l.email <> ''
           AND ${leadDateRangeSql('l')}
       )
       INSERT INTO email_broadcast_recipients (broadcast_id, lead_id, to_email)
       SELECT $3, lead_id, to_email FROM matched
       RETURNING 1 AS one`,
      [params.clientId, params.explicitLeadIds, broadcast.id]
    )
  } else {
    inserted = await query<{ one: number }>(
      `WITH matched AS (
         SELECT l.id AS lead_id, l.email AS to_email
         FROM leads l
         WHERE ${whereSql}
       )
       INSERT INTO email_broadcast_recipients (broadcast_id, lead_id, to_email)
       SELECT $${audienceParams.length + 1}, lead_id, to_email FROM matched
       RETURNING 1 AS one`,
      [...audienceParams, broadcast.id]
    )
  }

  const totalRecipients = inserted.length
  await query('UPDATE email_broadcasts SET total_recipients = $1 WHERE id = $2', [totalRecipients, broadcast.id])

  return { broadcastId: broadcast.id, totalRecipients }
}

export interface EmailBroadcastBatchResult {
  processed: number
  sent: number
  failed: number
  broadcastsCompleted: number
}

// Sends up to `batchSize` pending recipients (across all in-progress
// broadcasts, oldest first) via Resend. Every successful send is also
// logged into email_messages (the same table the per-lead Email tab
// reads from) and activity_log, so a broadcast email shows up in that
// lead's history exactly like a one-off email would — one source of
// truth for "what did we email this lead," regardless of which flow
// sent it. Meant to be called every ~30-60s by the same external cron
// scheduler already hitting the WhatsApp broadcast/sequence endpoints.
// Drains one institute's queue. Split out from processNextBatch because
// the cron endpoint has no session: query() resolves its database from
// whoever is logged in (see lib/db.ts) and throws outright when nobody is,
// which is why the cron was returning 500 rather than sending anything.
// Every statement here is therefore explicitly scoped with queryAsClient.
// Multi-tenant entry point for the cron endpoint. Each institute has its
// own database, so "drain pending broadcasts" means looping over every
// registered institute rather than querying one place — the institute list
// is central-registry data (lib/clientRegistry.ts), the queues are not.
//
// batchSize is per institute, so two institutes with work pending can send
// up to 2 x batchSize in one tick. Kept deliberately small: these now go
// through each school's own SMTP mailbox, which has a send-rate ceiling.
//
// One institute failing (unreachable database, bad credentials) must not
// stop the others, so each is wrapped individually and the error recorded
// rather than thrown.
export async function processNextBatch(batchSize = 20): Promise<EmailBroadcastBatchResult> {
  const clients = await centralQuery<{ id: string }>('SELECT id FROM clients')

  const total: EmailBroadcastBatchResult = { processed: 0, sent: 0, failed: 0, broadcastsCompleted: 0 }

  for (const client of clients) {
    try {
      const r = await processClientBatch(client.id, batchSize)
      total.processed += r.processed
      total.sent += r.sent
      total.failed += r.failed
      total.broadcastsCompleted += r.broadcastsCompleted
    } catch (err) {
      console.error(`[email-broadcast] client ${client.id} batch failed:`, err)
    }
  }

  return total
}

export async function processClientBatch(
  clientId: string,
  batchSize = 20
): Promise<EmailBroadcastBatchResult> {
  const pending = await queryAsClient<{ id: string; broadcast_id: string; lead_id: string; to_email: string }>(
  clientId,
`SELECT r.id, r.broadcast_id, r.lead_id, r.to_email
     FROM email_broadcast_recipients r
     JOIN email_broadcasts b ON b.id = r.broadcast_id
     WHERE r.status = 'pending' AND b.status = 'sending'
     ORDER BY b.created_at ASC, r.id ASC
     LIMIT $1`,
    [batchSize]
  )

  const result: EmailBroadcastBatchResult = { processed: 0, sent: 0, failed: 0, broadcastsCompleted: 0 }
  const touchedBroadcastIds = new Set<string>()

  for (const recipient of pending) {
    touchedBroadcastIds.add(recipient.broadcast_id)
    result.processed++

    const broadcast = (
      await queryAsClient<{
        subject: string
        body: string
        client_id: string
        preset_key: string | null
        cta_label: string | null
        cta_url: string | null
      }>(
        clientId,
        'SELECT subject, body, client_id, preset_key, cta_label, cta_url FROM email_broadcasts WHERE id = $1',
        [recipient.broadcast_id]
      )
    )[0]
    if (!broadcast) continue

    // Broadcasts now go out through the institute's OWN mailbox (the SMTP
    // account in Settings > Customize > School Email), the same path the
    // per-lead Email tab uses — not through a shared platform-wide Resend
    // domain. Parents therefore see mail genuinely from the school on both
    // one-off and bulk sends, and there is one set of credentials to keep
    // working instead of two.
    //
    // The tradeoff is real and worth knowing: an SMTP mailbox has send-rate
    // limits and no bounce or suppression handling. processNextBatch's
    // batchSize is what keeps this within a provider's per-minute ceiling,
    // so lower it rather than raising it if the provider starts throttling.
    const client = (
      await queryAsClient<{
        name: string
        school_email: string | null
        email_from_name: string | null
        smtp_host: string | null
        smtp_port: number | null
        smtp_user: string | null
        smtp_pass: string | null
      }>(
  clientId,
`SELECT name, school_email, email_from_name, smtp_host, smtp_port, smtp_user, smtp_pass
         FROM clients WHERE id = $1`,
        [broadcast.client_id]
      )
    )[0]

    // The HTML is built here, per recipient, rather than stored ready-made
    // on the broadcast. Two things have to differ for each person: their
    // name, and their own unsubscribe link. A single pre-rendered body
    // cannot carry either, and an unsubscribe link shared between
    // recipients would let one parent opt another one out.
    const lead = (
      await queryAsClient<{ full_name: string; unsubscribe_token: string | null }>(
        clientId,
        'SELECT full_name, unsubscribe_token FROM leads WHERE id = $1',
        [recipient.lead_id]
      )
    )[0]

    const preset = findPreset(broadcast.preset_key || 'announcement')
    const unsubscribeUrl = `${process.env.NEXT_PUBLIC_APP_URL || ''}/unsubscribe?t=${lead?.unsubscribe_token || ''}`

    const html = preset
      ? preset.build({
          institute: client?.name || 'Your school',
          parentName: lead?.full_name || 'there',
          body: broadcast.body,
          ctaLabel: broadcast.cta_label || undefined,
          ctaUrl: broadcast.cta_url || undefined,
          unsubscribeUrl,
          contactLine: `Sent by ${client?.name || 'your school'}${
            client?.school_email ? ` · ${client.school_email}` : ''
          }.`,
        })
      : broadcast.body

    const sendResult = await sendEmail(
      {
        host: client?.smtp_host || null,
        port: client?.smtp_port ?? null,
        user: client?.smtp_user || null,
        pass: client?.smtp_pass || null,
        fromEmail: client?.school_email || null,
        fromName: client?.email_from_name || client?.name || null,
      },
      {
        to: recipient.to_email,
        subject: broadcast.subject,
        body: html,
        html: true,
        failIfUnconfigured: true,
      }
    )

    if (sendResult.ok) {
      // resend_message_id stays NULL now that sends go via SMTP — the
      // column name is a leftover from the Resend path. Kept rather than
      // renamed so existing rows and history queries still line up.
      await queryAsClient(
        clientId,
        `UPDATE email_broadcast_recipients SET status = 'sent', sent_at = now() WHERE id = $1`,
        [recipient.id]
      )
      await queryAsClient(clientId, 'UPDATE email_broadcasts SET sent_count = sent_count + 1 WHERE id = $1', [recipient.broadcast_id])
      result.sent++
    } else {
      await queryAsClient(clientId, `UPDATE email_broadcast_recipients SET status = 'failed', error = $1 WHERE id = $2`, [
        sendResult.error || 'Unknown error',
        recipient.id,
      ])
      await queryAsClient(clientId, 'UPDATE email_broadcasts SET failed_count = failed_count + 1 WHERE id = $1', [recipient.broadcast_id])
      result.failed++
    }

    // Log into email_messages either way (sent or failed), matching how
    // the per-lead one-off email route logs both outcomes — keeps the
    // lead's Email tab history complete even for failures.
    await queryAsClient(
      clientId,
      `INSERT INTO email_messages (lead_id, template_key, subject, body, to_email, status, error)
       VALUES ($1, 'broadcast', $2, $3, $4, $5, $6)`,
      [
        recipient.lead_id,
        broadcast.subject,
        broadcast.body,
        recipient.to_email,
        sendResult.ok ? 'sent' : 'failed',
        sendResult.error || null,
      ]
    ).catch(() => {})
  }

  for (const broadcastId of touchedBroadcastIds) {
    const [{ remaining }] = await queryAsClient<{ remaining: string }>(
  clientId,
`SELECT COUNT(*)::int AS remaining FROM email_broadcast_recipients WHERE broadcast_id = $1 AND status = 'pending'`,
      [broadcastId]
    )
    if (Number(remaining) === 0) {
      await queryAsClient(clientId, `UPDATE email_broadcasts SET status = 'completed', completed_at = now() WHERE id = $1 AND status = 'sending'`, [
        broadcastId,
      ])
      result.broadcastsCompleted++
    }
  }

  return result
}

export interface EmailBroadcastListRow {
  id: string
  name: string
  subject: string
  status: string
  total_recipients: number
  sent_count: number
  failed_count: number
  created_at: string
  completed_at: string | null
}

export async function listBroadcasts(clientId: string): Promise<EmailBroadcastListRow[]> {
  return query<EmailBroadcastListRow>(
    `SELECT id, name, subject, status, total_recipients, sent_count, failed_count, created_at, completed_at
     FROM email_broadcasts
     WHERE client_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [clientId]
  )
}

export interface EmailBroadcastRecipientRow {
  lead_id: string
  full_name: string
  to_email: string
  status: string
  error: string | null
  sent_at: string | null
}

export async function getBroadcastDetail(broadcastId: string, clientId: string) {
  const broadcast = (
    await query(`SELECT * FROM email_broadcasts WHERE id = $1 AND client_id = $2`, [broadcastId, clientId])
  )[0]
  if (!broadcast) return null

  const recipients = await query<EmailBroadcastRecipientRow>(
    `SELECT r.lead_id, l.full_name, r.to_email, r.status, r.error, r.sent_at
     FROM email_broadcast_recipients r
     JOIN leads l ON l.id = r.lead_id
     WHERE r.broadcast_id = $1
     ORDER BY r.sent_at DESC NULLS LAST
     LIMIT 500`,
    [broadcastId]
  )

  return { broadcast, recipients }
}
