// path: lib/emailBroadcastTemplates.ts

// Three ready-made HTML emails for broadcasts.
//
// Written the way email actually works rather than the way a web page does:
// tables for layout, inline styles only, no flexbox or grid, no external
// stylesheet, no web fonts. Outlook renders with Word's engine and ignores
// almost everything else; 600px is the safe maximum width.
//
// Deliberately plain — no image headers, no multi-column layouts, no
// "LIMITED TIME" bars. Beyond taste, heavy promotional markup is exactly
// what spam filters score against, and a school's transactional mail sharing
// a domain with flagged campaigns is how the whole domain gets penalised.
//
// Every template ends with the unsubscribe link. It is not optional and the
// send path refuses a body without it.

export interface EmailTemplatePreset {
  key: string
  name: string
  description: string
  subject: string
  build: (vars: TemplateVars) => string
}

export interface TemplateVars {
  institute: string
  parentName: string
  body: string
  ctaLabel?: string
  ctaUrl?: string
  unsubscribeUrl: string
  contactLine?: string
}

const FONT = "font-family:Arial,Helvetica,sans-serif;"

// Rendered into every template rather than written three times, so a change
// to the legal footer can't be applied to two of them and missed on the
// third.
function footer(vars: TemplateVars): string {
  return `
    <tr><td style="padding:24px 28px 28px;border-top:1px solid #E5E7EB;">
      <p style="margin:0 0 8px;${FONT}font-size:12px;line-height:18px;color:#6B7280;">
        ${escapeHtml(vars.contactLine || `Sent by ${vars.institute}.`)}
      </p>
      <p style="margin:0;${FONT}font-size:12px;line-height:18px;color:#6B7280;">
        Don't want these emails?
        <a href="${vars.unsubscribeUrl}" style="color:#2563EB;">Unsubscribe</a>.
      </p>
    </td></tr>`
}

function button(vars: TemplateVars, colour: string): string {
  if (!vars.ctaUrl || !vars.ctaLabel) return ''
  // A table-wrapped anchor, not a styled <button>: Outlook drops padding on
  // inline elements, so the coloured block has to be the table cell itself.
  return `
    <tr><td align="center" style="padding:8px 28px 28px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr><td align="center" style="background-color:${colour};border-radius:6px;">
          <a href="${vars.ctaUrl}" style="display:inline-block;padding:12px 28px;${FONT}font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;">${escapeHtml(
            vars.ctaLabel
          )}</a>
        </td></tr>
      </table>
    </td></tr>`
}

function shell(inner: string, preheader: string): string {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#F3F4F6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F3F4F6;">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background-color:#FFFFFF;border-radius:10px;">
    ${inner}
  </table>
</td></tr></table>
</body></html>`
}

// Bodies are typed by a person into a textarea, so they are escaped and
// their line breaks turned into paragraphs. Letting raw HTML through would
// mean one mistyped angle bracket breaking the layout for every recipient.
function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;${FONT}font-size:15px;line-height:23px;color:#374151;">${escapeHtml(p).replace(
          /\n/g,
          '<br/>'
        )}</p>`
    )
    .join('')
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export const EMAIL_TEMPLATE_PRESETS: EmailTemplatePreset[] = [
  {
    key: 'announcement',
    name: 'Announcement',
    description: 'A plain letter from the school. Best for news, dates and general updates.',
    subject: 'A note from {{institute}}',
    build: (v) =>
      shell(
        `
    <tr><td style="padding:28px 28px 8px;">
      <p style="margin:0 0 4px;${FONT}font-size:13px;letter-spacing:1px;color:#6B7280;text-transform:uppercase;">${escapeHtml(
        v.institute
      )}</p>
      <p style="margin:0 0 18px;${FONT}font-size:16px;color:#111827;">Dear ${escapeHtml(v.parentName)},</p>
      ${paragraphs(v.body)}
    </td></tr>
    ${button(v, '#2563EB')}
    ${footer(v)}`,
        v.body.slice(0, 90)
      ),
  },
  {
    key: 'invitation',
    name: 'Invitation',
    description: 'For open days, orientations and campus visits. Leads with the date and a single button.',
    subject: "You're invited — {{institute}}",
    build: (v) =>
      shell(
        `
    <tr><td align="center" style="padding:32px 28px 12px;">
      <p style="margin:0 0 6px;${FONT}font-size:13px;letter-spacing:1px;color:#6B7280;text-transform:uppercase;">${escapeHtml(
        v.institute
      )}</p>
      <h1 style="margin:0;${FONT}font-size:24px;font-weight:bold;color:#111827;">You're invited</h1>
    </td></tr>
    <tr><td style="padding:8px 28px 4px;">
      <p style="margin:0 0 14px;${FONT}font-size:15px;color:#374151;">Dear ${escapeHtml(v.parentName)},</p>
      ${paragraphs(v.body)}
    </td></tr>
    ${button(v, '#059669')}
    ${footer(v)}`,
        v.body.slice(0, 90)
      ),
  },
  {
    key: 'reminder',
    name: 'Reminder',
    description: 'Short and direct. For deadlines, pending documents and unfinished admissions.',
    subject: 'A quick reminder from {{institute}}',
    build: (v) =>
      shell(
        `
    <tr><td style="padding:28px 28px 4px;">
      <p style="margin:0 0 14px;${FONT}font-size:15px;color:#374151;">Dear ${escapeHtml(v.parentName)},</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FEF3C7;border-radius:8px;">
        <tr><td style="padding:16px 18px;">
          ${paragraphs(v.body).replace(/color:#374151/g, 'color:#78350F')}
        </td></tr>
      </table>
    </td></tr>
    ${button(v, '#D97706')}
    ${footer(v)}`,
        v.body.slice(0, 90)
      ),
  },
]

export function findPreset(key: string): EmailTemplatePreset | null {
  return EMAIL_TEMPLATE_PRESETS.find((p) => p.key === key) || null
}
