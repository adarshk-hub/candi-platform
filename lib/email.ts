// path: lib/email.ts
import nodemailer from 'nodemailer'

interface SendResult {
  ok: boolean
  error?: string
}

export interface SmtpConfig {
  host: string | null
  port: number | null
  user: string | null
  pass: string | null
  fromEmail: string | null
  fromName: string | null
}

export interface EmailAttachment {
  filename: string
  contentType: string
  // Base64, without the data: URI prefix — the browser's FileReader gives a
  // data URL, and the API route strips the header before it gets here.
  data: string
}

// Sends via the institute's own mailbox (SMTP), not a shared agency-wide
// provider — each school configures its own account in Settings > Customize
// > School Email so recipients see mail genuinely coming from the school,
// not a third-party sender. Until a client has host/user/pass/fromEmail
// set, sends are logged and treated as successful without hitting the
// network, matching the stub pattern used for Aisensy/Meta elsewhere in
// this project — so the Email tab is fully usable in dev before any real
// mailbox is connected.
export async function sendEmail(
  config: SmtpConfig,
  params: {
    to: string
    subject: string
    body: string
    // Broadcast bodies are HTML; per-lead emails are plain text. Sending
    // HTML as `text` delivers visible markup to the recipient, so the
    // caller has to say which it is.
    html?: boolean
    // Broadcasts pass true: the stub-success path below is right for a
    // dev inbox but wrong for a bulk send, where it would silently mark
    // every recipient 'sent' while nothing left the building. With this
    // set, an unconfigured mailbox fails loudly and the error lands on
    // the recipient row where someone will see it.
    failIfUnconfigured?: boolean
    attachments?: EmailAttachment[]
  }
): Promise<SendResult> {
  if (!config.host || !config.user || !config.pass || !config.fromEmail) {
    if (params.failIfUnconfigured) {
      return {
        ok: false,
        error:
          'This institute has no mailbox configured — set SMTP host, username, password and the From address under Settings > Customize > School Email.',
      }
    }
    console.log(
      `[email:stub] would send "${params.subject}" to ${params.to} from ${config.fromEmail || '<school_email unset>'}` +
        (params.attachments?.length ? ` with ${params.attachments.length} attachment(s)` : '')
    )
    return { ok: true }
  }

  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port || 587,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.pass },
    })
    await transporter.sendMail({
      from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
      to: params.to,
      subject: params.subject,
      ...(params.html ? { html: params.body } : { text: params.body }),
      // Decoded here rather than passed through as a base64 string, so
      // nodemailer sets the transfer encoding and MIME boundaries itself.
      ...(params.attachments?.length
        ? {
            attachments: params.attachments.map((a) => ({
              filename: a.filename,
              content: Buffer.from(a.data, 'base64'),
              contentType: a.contentType || 'application/octet-stream',
            })),
          }
        : {}),
    })
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Email send failed' }
  }
}
