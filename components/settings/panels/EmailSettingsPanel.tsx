// path: components/settings/panels/EmailSettingsPanel.tsx
'use client'

import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'

export default function EmailSettingsPanel({ clientId }: { clientId: string }) {
  const [schoolEmail, setSchoolEmail] = useState('')
  const [fromName, setFromName] = useState('')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('')
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPass, setSmtpPass] = useState('')
  const [passAlreadySet, setPassAlreadySet] = useState(false)
  // Incoming mail. Kept in its own set of fields because almost every
  // provider uses a different host for reading than for sending.
  const [imapHost, setImapHost] = useState('')
  const [imapPort, setImapPort] = useState('')
  const [imapUser, setImapUser] = useState('')
  const [imapPass, setImapPass] = useState('')
  const [imapPassAlreadySet, setImapPassAlreadySet] = useState(false)
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/clients/${clientId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setSchoolEmail(data.school_email || '')
          setFromName(data.email_from_name || '')
          setSmtpHost(data.smtp_host || '')
          setSmtpPort(data.smtp_port ? String(data.smtp_port) : '')
          setSmtpUser(data.smtp_user || '')
          setPassAlreadySet(!!data.smtp_pass_set)
          setImapHost(data.imap_host || '')
          setImapPort(data.imap_port ? String(data.imap_port) : '')
          setImapUser(data.imap_user || '')
          setImapPassAlreadySet(!!data.imap_pass_set)
          setLastSynced(data.imap_last_synced_at || null)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [clientId])

  async function save() {
    setSaving(true)
    setError('')
    setStatus('')
    try {
      const body: any = {
        schoolEmail,
        emailFromName: fromName,
        smtpHost,
        smtpPort: smtpPort || null,
        smtpUser,
        imapHost,
        imapPort: imapPort || null,
        imapUser,
      }
      // Only overwrite a stored password if a new one was actually typed —
      // leaving the field blank keeps the existing credential rather than
      // clearing it, since we never send the current password back down to
      // prefill the field.
      if (smtpPass) body.smtpPass = smtpPass
      if (imapPass) body.imapPass = imapPass

      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setError(b.error || 'Failed to save')
        return
      }
      const updated = await res.json()
      setPassAlreadySet(!!updated.smtp_pass_set)
      setImapPassAlreadySet(!!updated.imap_pass_set)
      setSmtpPass('')
      setImapPass('')
      setStatus('Saved.')
    } catch (err: any) {
      setError(err?.message || 'Network error — could not reach the server')
    } finally {
      setSaving(false)
    }
  }

  function copyFromSmtp() {
    setImapUser(smtpUser)
    setImapHost(smtpHost.replace(/^smtp\./i, 'imap.'))
    setImapPort('993')
  }

  if (loading) return <p className="text-muted">Loading…</p>

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-border bg-card p-5">
        <h2 className="mb-1 text-lg font-bold text-fg">Sending (SMTP)</h2>
        <p className="mb-4 text-sm text-muted2">
          Stage and reminder emails send from this mailbox, alongside WhatsApp. Works with Gmail, Office 365, or any SMTP account —
          for Gmail, use an{' '}
          <a
            href="https://support.google.com/mail/answer/185833"
            target="_blank"
            rel="noreferrer"
            className="text-blue-400 hover:underline"
          >
            App Password
          </a>
          , not your regular password.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs text-muted">School Email (From address)</label>
            <input
              type="email"
              value={schoolEmail}
              onChange={(e) => setSchoolEmail(e.target.value)}
              placeholder="admissions@yourschool.edu"
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">From Name</label>
            <input
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="Apex Learning Academy"
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">SMTP Host</label>
            <input
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              placeholder="smtp.gmail.com"
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">SMTP Port</label>
            <input
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
              placeholder="587"
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">SMTP Username</label>
            <input
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              placeholder="admissions@yourschool.edu"
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">
              SMTP Password {passAlreadySet && <span className="text-green-400">(already set)</span>}
            </label>
            <input
              type="password"
              value={smtpPass}
              onChange={(e) => setSmtpPass(e.target.value)}
              placeholder={passAlreadySet ? 'Leave blank to keep current' : 'App password'}
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      <div className="rounded-card border border-border bg-card p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-bold text-fg">Receiving (IMAP)</h2>
          <button onClick={copyFromSmtp} className="text-xs text-blue-400 hover:underline">
            Fill from SMTP
          </button>
        </div>
        <p className="mb-4 text-sm text-muted2">
          What the Inbox reads. Replies from parents are matched back to the lead by email address, and to the
          phone number in the message if the address doesn’t match. Port 993 for almost every provider.
          {lastSynced && (
            <span className="mt-1 block text-xs text-muted">
              Last checked {new Date(lastSynced).toLocaleString('en-IN')}.
            </span>
          )}
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs text-muted">IMAP Host</label>
            <input
              value={imapHost}
              onChange={(e) => setImapHost(e.target.value)}
              placeholder="imap.gmail.com"
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">IMAP Port</label>
            <input
              value={imapPort}
              onChange={(e) => setImapPort(e.target.value)}
              placeholder="993"
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">IMAP Username</label>
            <input
              value={imapUser}
              onChange={(e) => setImapUser(e.target.value)}
              placeholder="admissions@yourschool.edu"
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">
              IMAP Password {imapPassAlreadySet && <span className="text-green-400">(already set)</span>}
            </label>
            <input
              type="password"
              value={imapPass}
              onChange={(e) => setImapPass(e.target.value)}
              placeholder={imapPassAlreadySet ? 'Leave blank to keep current' : 'App password'}
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {status && <p className="text-sm text-green-400">{status}</p>}

      <button
        onClick={save}
        disabled={saving}
        className="flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
      >
        <Check size={16} /> {saving ? 'Saving…' : 'Save Email Settings'}
      </button>

      {!schoolEmail || !smtpHost || !smtpUser || (!passAlreadySet && !smtpPass) ? (
        <p className="text-xs text-muted">
          Until the sending fields are filled in, emails are logged to the server console instead of actually sending — safe to leave
          unconfigured while testing. The Inbox stays empty until the receiving fields are set too.
        </p>
      ) : null}
    </div>
  )
}
