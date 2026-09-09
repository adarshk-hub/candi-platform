// path: lib/emailInbox.ts
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { queryAsClient } from './db'
import { normalizePhone } from './leadIntake'

export interface ImapConfig {
  host: string | null
  port: number | null
  user: string | null
  pass: string | null
  lastUid: number | null
}

export interface SyncResult {
  ok: boolean
  fetched: number
  matched: number
  error?: string
}

// Pulls new mail from the institute's own mailbox into email_messages, so the
// Inbox and each lead's Email tab show replies alongside what was sent.
//
// Pull-on-demand rather than a push webhook: IMAP has no equivalent of a
// webhook that a hosted CRM can subscribe to, and asking every school to set
// up mail forwarding into a parsing service is a support burden they don't
// need. The cost is that "new" mail is as fresh as the last sync — which is
// why the Inbox has a Refresh button as well as a cron.
export async function syncInbox(clientId: string): Promise<SyncResult> {
  const [client] = await queryAsClient<{
    imap_host: string | null
    imap_port: number | null
    imap_user: string | null
    imap_pass: string | null
    imap_last_uid: string | number | null
    school_email: string | null
  }>(
    clientId,
    `SELECT imap_host, imap_port, imap_user, imap_pass, imap_last_uid, school_email
     FROM clients WHERE id = $1`,
    [clientId]
  )

  if (!client?.imap_host || !client.imap_user || !client.imap_pass) {
    return {
      ok: false,
      fetched: 0,
      matched: 0,
      error: 'No incoming mailbox configured — add IMAP host, username and password under Settings > Customize > School Email.',
    }
  }

  const lastUid = Number(client.imap_last_uid || 0)
  const imap = new ImapFlow({
    host: client.imap_host,
    port: client.imap_port || 993,
    secure: (client.imap_port || 993) === 993,
    auth: { user: client.imap_user, pass: client.imap_pass },
    logger: false,
  })

  let fetched = 0
  let matched = 0
  let highestUid = lastUid

  try {
    await imap.connect()
    const lock = await imap.getMailboxLock('INBOX')
    try {
      // On a first-ever sync there is no watermark, and pulling an entire
      // historical mailbox would be both slow and mostly irrelevant. Starting
      // from "everything newer than UID 1" but capped by the server's own
      // recent range keeps the first run sane; every run after that is
      // strictly incremental.
      const range = lastUid > 0 ? `${lastUid + 1}:*` : '1:*'

      for await (const message of imap.fetch(range, { uid: true, source: true }, { uid: true })) {
        const uid = Number(message.uid)
        // A `x:*` range always returns at least the last message even when
        // nothing is newer, so the watermark itself has to be skipped
        // explicitly or every sync would re-import one message.
        if (uid <= lastUid) continue
        if (uid > highestUid) highestUid = uid

        const parsed = await simpleParser(message.source as Buffer)
        const fromEmail = parsed.from?.value?.[0]?.address?.toLowerCase() || null
        const subject = parsed.subject || '(no subject)'
        const body = parsed.text || stripHtml(parsed.html || '') || ''
        const messageId = parsed.messageId || `imap:${clientId}:${uid}`
        const receivedAt = parsed.date || new Date()

        const leadId = fromEmail ? await findLeadByEmail(clientId, fromEmail, parsed.text || '') : null

        // ON CONFLICT rather than a pre-check: two syncs racing (the cron and
        // somebody pressing Refresh) would both pass a check-then-insert.
        await queryAsClient(
          clientId,
          `INSERT INTO email_messages
             (client_id, lead_id, direction, subject, body, to_email, from_email,
              status, external_message_id, received_at, is_read)
           VALUES ($1,$2,'inbound',$3,$4,$5,$6,'received',$7,$8,false)
           ON CONFLICT (external_message_id) DO NOTHING`,
          [
            clientId,
            leadId,
            subject.slice(0, 500),
            body.slice(0, 20000),
            client.school_email || client.imap_user,
            fromEmail,
            messageId,
            receivedAt.toISOString(),
          ]
        )

        fetched++
        if (leadId) {
          matched++
          await queryAsClient(
            clientId,
            `INSERT INTO activity_log (lead_id, activity_type, title, description)
             VALUES ($1, 'system', 'Email Received', $2)`,
            [leadId, `Reply received: "${subject.slice(0, 200)}"`]
          ).catch(() => {})
        }
      }
    } finally {
      lock.release()
    }

    if (highestUid > lastUid) {
      await queryAsClient(clientId, 'UPDATE clients SET imap_last_uid = $1 WHERE id = $2', [highestUid, clientId])
    }
    await queryAsClient(clientId, 'UPDATE clients SET imap_last_synced_at = now() WHERE id = $1', [clientId])

    return { ok: true, fetched, matched }
  } catch (err: any) {
    console.error('[emailInbox] sync failed:', err)
    return { ok: false, fetched, matched, error: err?.message || 'Could not reach the mailbox.' }
  } finally {
    await imap.logout().catch(() => {})
  }
}

// Matches a reply back to the lead who sent it. Email address first, since
// that's exact. Phone number in the body is the fallback for the common case
// of a parent writing from a different address than the one on the enquiry
// form but quoting their number in the signature.
async function findLeadByEmail(clientId: string, fromEmail: string, body: string): Promise<string | null> {
  const byEmail = await queryAsClient<{ id: string }>(
    clientId,
    'SELECT id FROM leads WHERE lower(email) = $1 ORDER BY created_at DESC LIMIT 1',
    [fromEmail]
  )
  if (byEmail[0]) return byEmail[0].id

  const phoneMatch = body.match(/(\+?\d[\d\s-]{8,}\d)/)
  if (phoneMatch) {
    const normalized = normalizePhone(phoneMatch[1])
    if (normalized.length === 10) {
      const byPhone = await queryAsClient<{ id: string }>(
        clientId,
        'SELECT id FROM leads WHERE normalized_phone = $1 LIMIT 1',
        [normalized]
      )
      if (byPhone[0]) return byPhone[0].id
    }
  }

  return null
}

// Deliberately crude: this is for storing a readable plain-text fallback when
// a message is HTML-only, not for rendering. Anything cleverer would mean
// pulling in a sanitiser to protect a string we never inject as markup.
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
