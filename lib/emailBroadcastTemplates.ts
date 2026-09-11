// path: lib/emailBroadcastTemplates.ts

// Three HTML designs for broadcast emails.
//
// Built the way email actually works rather than the way a web page does:
// nested tables for layout, inline styles only, no flexbox, no grid, no
// external stylesheet, no web fonts. Outlook renders with Word's engine and
// silently drops most modern CSS, so anything structural has to be a table
// cell and anything coloured has to be a background on that cell.
//
// They are designed rather than plain — a coloured masthead, a monogram, a
// rule under the greeting, a proper button, a structured footer. What they
// deliberately avoid is the *promotional* look: no image banners, no
// multi-column blocks, no "LIMITED TIME" bars. That restraint isn't taste.
// Heavy campaign markup is what spam filters score against, and a school's
// ordinary mail shares a domain with these — a penalised domain means the
// office's one-to-one email stops arriving too.
//
// Every design ends with the unsubscribe link. It is not optional.

export interface EmailTemplatePreset {
  key: string
  name: string
  description: string
  subject: string
  accent: string
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
  // Optional label/value rows — "When: Saturday 14 June", "Where: Main
  // campus". Rendered as a bordered panel, which is where an invitation
  // stops being a wall of prose.
  details?: { label: string; value: string }[]
}

const SANS = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"
const SERIF = "font-family:Georgia,'Times New Roman',serif;"

const INK = '#1F2937'
const BODY_INK = '#4B5563'
const MUTED = '#9CA3AF'
const HAIRLINE = '#E5E7EB'

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Bodies are typed into a textarea by a person, so they are escaped and
// their blank lines turned into paragraphs. Letting raw HTML through would
// mean one stray angle bracket breaking the layout for every recipient.
function paragraphs(text: string, colour = BODY_INK): string {
  return text
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map(
      (p) =>
        `<p style="margin:0 0 16px;${SANS}font-size:15px;line-height:25px;color:${colour};">${escapeHtml(
          p
        ).replace(/\n/g, '<br/>')}</p>`
    )
    .join('')
}

// The institute's initials in a circle. A real logo would be better, but it
// would have to be hosted, and a broken image in a school's email is worse
// than no image — this always renders, including with images disabled.
function monogram(institute: string, accent: string): string {
  const initials = institute
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
      <tr><td align="center" width="52" height="52" style="width:52px;height:52px;background-color:#FFFFFF;border-radius:26px;${SERIF}font-size:19px;font-weight:bold;color:${accent};line-height:52px;">${escapeHtml(
        initials || 'S'
      )}</td></tr>
    </table>`
}

function masthead(vars: TemplateVars, accent: string, kicker: string): string {
  return `
    <tr><td align="center" style="background-color:${accent};padding:28px 28px 24px;border-radius:12px 12px 0 0;">
      ${monogram(vars.institute, accent)}
      <p style="margin:14px 0 0;${SANS}font-size:16px;font-weight:600;letter-spacing:0.3px;color:#FFFFFF;">${escapeHtml(
        vars.institute
      )}</p>
      <p style="margin:4px 0 0;${SANS}font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.75);">${escapeHtml(
        kicker
      )}</p>
    </td></tr>`
}

function greeting(vars: TemplateVars): string {
  return `
    <tr><td style="padding:30px 32px 0;">
      <p style="margin:0 0 4px;${SERIF}font-size:19px;color:${INK};">Dear ${escapeHtml(vars.parentName)},</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="44">
        <tr><td height="3" style="height:3px;background-color:${HAIRLINE};font-size:0;line-height:0;">&nbsp;</td></tr>
      </table>
    </td></tr>`
}

function detailPanel(vars: TemplateVars, accent: string): string {
  if (!vars.details?.length) return ''
  const rows = vars.details
    .filter((d) => d.label && d.value)
    .map(
      (d) => `
      <tr>
        <td style="padding:7px 0;${SANS}font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${MUTED};width:34%;vertical-align:top;">${escapeHtml(
          d.label
        )}</td>
        <td style="padding:7px 0;${SANS}font-size:15px;color:${INK};font-weight:600;">${escapeHtml(d.value)}</td>
      </tr>`
    )
    .join('')
  if (!rows) return ''
  return `
    <tr><td style="padding:4px 32px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F9FAFB;border-left:3px solid ${accent};border-radius:0 8px 8px 0;">
        <tr><td style="padding:14px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
        </td></tr>
      </table>
    </td></tr>`
}

// A table-wrapped anchor, not a styled <button>: Outlook drops padding on
// inline elements, so the coloured block has to be the cell itself.
function button(vars: TemplateVars, accent: string): string {
  if (!vars.ctaUrl || !vars.ctaLabel) return ''
  return `
    <tr><td align="center" style="padding:10px 32px 30px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr><td align="center" style="background-color:${accent};border-radius:6px;">
          <a href="${vars.ctaUrl}" style="display:inline-block;padding:13px 34px;${SANS}font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;">${escapeHtml(
            vars.ctaLabel
          )}</a>
        </td></tr>
      </table>
    </td></tr>`
}

// One footer for all three, so a change to the legal text can't be applied
// to two designs and missed on the third.
function footer(vars: TemplateVars): string {
  return `
    <tr><td style="padding:0 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td height="1" style="height:1px;background-color:${HAIRLINE};font-size:0;line-height:0;">&nbsp;</td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:20px 32px 30px;">
      <p style="margin:0 0 6px;${SANS}font-size:12px;line-height:19px;color:${BODY_INK};">${escapeHtml(
        vars.contactLine || `Sent by ${vars.institute}.`
      )}</p>
      <p style="margin:0;${SANS}font-size:12px;line-height:19px;color:${MUTED};">
        Prefer not to receive these? <a href="${vars.unsubscribeUrl}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a>.
      </p>
    </td></tr>`
}

function shell(inner: string, preheader: string): string {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#EEF1F5;">
<!-- Preview text: shown in the inbox list beside the subject, hidden in the
     message itself. Without it, clients show the first words of the
     masthead, which is the institute's name repeated. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EEF1F5;">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background-color:#FFFFFF;border-radius:12px;">
    ${inner}
  </table>
  <p style="margin:16px 0 0;${SANS}font-size:11px;color:#9AA1AC;">This email was sent to you because you enquired with us.</p>
</td></tr></table>
</body></html>`
}

export const EMAIL_TEMPLATE_PRESETS: EmailTemplatePreset[] = [
  {
    key: 'announcement',
    name: 'Announcement',
    description: 'A letter from the school. Best for news, policy changes and general updates.',
    subject: 'A note from {{institute}}',
    accent: '#1E3A5F',
    build: (v) =>
      shell(
        `${masthead(v, '#1E3A5F', 'Announcement')}
         ${greeting(v)}
         <tr><td style="padding:18px 32px 4px;">${paragraphs(v.body)}</td></tr>
         ${detailPanel(v, '#1E3A5F')}
         ${button(v, '#1E3A5F')}
         ${footer(v)}`,
        v.body.slice(0, 100)
      ),
  },
  {
    key: 'invitation',
    name: 'Invitation',
    description: 'Open days, orientations and campus visits. Leads with a headline and a details panel.',
    subject: "You're invited — {{institute}}",
    accent: '#0F6E4F',
    build: (v) =>
      shell(
        `${masthead(v, '#0F6E4F', 'Invitation')}
         <tr><td align="center" style="padding:32px 32px 6px;">
           <h1 style="margin:0;${SERIF}font-size:27px;font-weight:normal;color:${INK};">You're invited</h1>
         </td></tr>
         <tr><td style="padding:14px 32px 0;">
           <p style="margin:0 0 14px;${SANS}font-size:15px;color:${INK};">Dear ${escapeHtml(v.parentName)},</p>
           ${paragraphs(v.body)}
         </td></tr>
         ${detailPanel(v, '#0F6E4F')}
         ${button(v, '#0F6E4F')}
         ${footer(v)}`,
        v.body.slice(0, 100)
      ),
  },
  {
    key: 'reminder',
    name: 'Reminder',
    description: 'Short and direct. Deadlines, pending documents, unfinished admissions.',
    subject: 'A quick reminder from {{institute}}',
    accent: '#9A5B00',
    build: (v) =>
      shell(
        `${masthead(v, '#9A5B00', 'Reminder')}
         ${greeting(v)}
         <tr><td style="padding:18px 32px 4px;">
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFF8EC;border:1px solid #F5DFB8;border-radius:8px;">
             <tr><td style="padding:18px 20px 4px;">${paragraphs(v.body, '#6B4708')}</td></tr>
           </table>
         </td></tr>
         ${detailPanel(v, '#9A5B00')}
         ${button(v, '#9A5B00')}
         ${footer(v)}`,
        v.body.slice(0, 100)
      ),
  },
]

export function findPreset(key: string): EmailTemplatePreset | null {
  return EMAIL_TEMPLATE_PRESETS.find((p) => p.key === key) || null
}
