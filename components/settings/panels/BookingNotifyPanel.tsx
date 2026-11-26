// path: components/settings/panels/BookingNotifyPanel.tsx
'use client'

import { useEffect, useState } from 'react'
import { MessageCircle, MessageSquare, Mail } from 'lucide-react'

type Kind = 'on_booking' | 'before_1h' | 'before_10m'
type Channel = 'whatsapp' | 'sms' | 'email'
type Mode = 'auto' | 'manual' | 'off'
interface ChannelCfg {
  mode: Mode
  template?: string
  params?: string[]
  name?: string
  templateId?: string
  text?: string
  subject?: string
  body?: string
}
type Config = Partial<Record<Kind, Partial<Record<Channel, ChannelCfg>>>>
interface WaTemplate {
  name: string
  body: string
  variables: number
}

const KINDS: { key: Kind; label: string; hint: string }[] = [
  { key: 'on_booking', label: 'Right after booking', hint: 'When a call is booked or rescheduled.' },
  { key: 'before_1h', label: '1 hour before', hint: 'Sent automatically 1 hour before the call.' },
  { key: 'before_10m', label: '10 minutes before', hint: 'Sent automatically 10 minutes before the call.' },
]
const CHANNELS: { key: Channel; label: string; icon: any }[] = [
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { key: 'sms', label: 'SMS', icon: MessageSquare },
  { key: 'email', label: 'Email', icon: Mail },
]
const VARS: { key: string; label: string }[] = [
  { key: 'name', label: 'Full name' },
  { key: 'company', label: 'Company name' },
  { key: 'date', label: 'Booking date' },
  { key: 'time', label: 'Booking time' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'city', label: 'City' },
  { key: 'school', label: 'Your business name' },
]

const input =
  'w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500'

// Local Octo only: the WhatsApp, SMS and email a lead gets when a call is
// booked, 1 hour before and 10 minutes before — templates and modes, all
// saved in the database and editable here.
export default function BookingNotifyPanel({ clientId }: { clientId: string }) {
  const [config, setConfig] = useState<Config>({})
  const [waTemplates, setWaTemplates] = useState<WaTemplate[]>([])
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/clients/${clientId}/booking-notify-config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setEnabled(d?.enabled !== false)
        setConfig(d?.config || {})
        setWaTemplates(d?.waTemplates || [])
      })
      .finally(() => setLoading(false))
  }, [clientId])

  function cfg(kind: Kind, ch: Channel): ChannelCfg {
    return config[kind]?.[ch] || { mode: 'off' }
  }
  function update(kind: Kind, ch: Channel, patch: Partial<ChannelCfg>) {
    setConfig((prev) => ({ ...prev, [kind]: { ...(prev[kind] || {}), [ch]: { ...cfg(kind, ch), ...patch } } }))
    setMessage('')
  }

  async function save() {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const res = await fetch(`/api/clients/${clientId}/booking-notify-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Could not save.')
        return
      }
      setConfig(b.config || config)
      setMessage('Saved.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-muted">Loading…</p>
  if (!enabled) return <p className="text-muted">Booking reminders are not set up for this institute.</p>

  return (
    <div className="space-y-5">
      <div className="rounded-card border border-border bg-card p-5">
        <h2 className="mb-1 text-lg font-bold text-fg">Booking Reminders</h2>
        <p className="text-sm text-muted2">
          What the lead gets when a call is booked, 1 hour before and 10 minutes before. <b>Automatic</b> sends by itself.{' '}
          <b>Ask before sending</b> (right after booking only) shows the message in the Bookings tab first. <b>Off</b> never
          sends. WhatsApp and SMS use your approved templates; email can be written freely. Booking details are filled in
          from the lead and the call.
        </p>
      </div>

      {KINDS.map((k) => (
        <div key={k.key} className="rounded-card border border-border bg-card p-5">
          <h3 className="font-semibold text-fg">{k.label}</h3>
          <p className="mb-4 text-xs text-muted">{k.hint}</p>

          <div className="grid gap-4 lg:grid-cols-3">
            {CHANNELS.map((ch) => {
              const c = cfg(k.key, ch.key)
              const Icon = ch.icon
              const wa = waTemplates.find((t) => t.name === c.template)
              return (
                <div key={ch.key} className="rounded-md border border-border p-3">
                  <div className="mb-3 flex items-center gap-2">
                    <Icon size={16} className="text-muted2" />
                    <span className="text-sm font-medium text-fg">{ch.label}</span>
                    <select
                      value={c.mode}
                      onChange={(e) => update(k.key, ch.key, { mode: e.target.value as Mode })}
                      className="ml-auto rounded-md border border-border bg-card2 px-2 py-1 text-xs text-fg outline-none focus:border-blue-500"
                    >
                      <option value="auto">Automatic</option>
                      {k.key === 'on_booking' && <option value="manual">Ask before sending</option>}
                      <option value="off">Off</option>
                    </select>
                  </div>

                  {ch.key === 'whatsapp' && (
                    <div className="space-y-2">
                      <select
                        value={c.template || ''}
                        onChange={(e) => update(k.key, ch.key, { template: e.target.value, params: [] })}
                        className={input}
                      >
                        <option value="">Choose an approved template…</option>
                        {waTemplates.map((t) => (
                          <option key={t.name} value={t.name}>
                            {t.name}
                          </option>
                        ))}
                        {c.template && !wa && <option value={c.template}>{c.template} (not approved yet)</option>}
                      </select>
                      {wa && <p className="whitespace-pre-wrap rounded bg-card2 p-2 text-xs text-muted2">{wa.body}</p>}
                      {wa &&
                        Array.from({ length: wa.variables }).map((_, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <code className="w-12 text-xs text-muted">{`{{${i + 1}}}`}</code>
                            <select
                              value={c.params?.[i] || ''}
                              onChange={(e) => {
                                const next = [...(c.params || [])]
                                next[i] = e.target.value
                                update(k.key, ch.key, { params: next })
                              }}
                              className={input}
                            >
                              <option value="">Choose…</option>
                              {VARS.map((v) => (
                                <option key={v.key} value={v.key}>
                                  {v.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                    </div>
                  )}

                  {ch.key === 'sms' && (
                    <div className="space-y-2">
                      <input
                        value={c.name || ''}
                        onChange={(e) => update(k.key, ch.key, { name: e.target.value })}
                        placeholder="Template name, e.g. lo_call_confirmed"
                        className={input}
                      />
                      <input
                        value={c.templateId || ''}
                        onChange={(e) => update(k.key, ch.key, { templateId: e.target.value })}
                        placeholder="MSG91 template ID"
                        className={input}
                      />
                      <textarea
                        value={c.text || ''}
                        onChange={(e) => update(k.key, ch.key, { text: e.target.value })}
                        rows={4}
                        placeholder="Exact approved text with ##name##, ##date##, ##time##…"
                        className={input}
                      />
                      <p className="text-[11px] text-muted">
                        Paste the text exactly as approved. Variables: ##name## ##company## ##date## ##time##
                      </p>
                    </div>
                  )}

                  {ch.key === 'email' && (
                    <div className="space-y-2">
                      <input
                        value={c.subject || ''}
                        onChange={(e) => update(k.key, ch.key, { subject: e.target.value })}
                        placeholder="Subject"
                        className={input}
                      />
                      <textarea
                        value={c.body || ''}
                        onChange={(e) => update(k.key, ch.key, { body: e.target.value })}
                        rows={6}
                        placeholder="Message"
                        className={input}
                      />
                      <p className="text-[11px] text-muted">
                        Variables: {'{{name}} {{company}} {{date}} {{time}} {{school}}'}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Booking Reminders'}
        </button>
        {message && <span className="text-sm text-green-500">{message}</span>}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
    </div>
  )
}
