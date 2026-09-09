// path: components/lead/AddLeadModal.tsx
'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { clsx } from 'clsx'
import { SOURCE_LABEL, TIMELINE_LABEL, DECISION_MAKER_LABEL } from '@/lib/types'

interface CustomFieldDef {
  field_key: string
  label: string
  field_type: 'text' | 'dropdown' | 'date' | 'time' | 'number'
  options: string[] | null
  is_active: boolean
}

interface SourceOption {
  value: string
}

interface DuplicateLead {
  id: string
  lead_number: number
  full_name: string
  whatsapp_number: string
  counsellor_name: string | null
}

export default function AddLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [session, setSession] = useState<{ role: string; clientId: string | null } | null>(null)
  const [institutes, setInstitutes] = useState<{ id: string; name: string }[]>([])
  const [clientId, setClientId] = useState('')
  const [sources, setSources] = useState<SourceOption[]>([])
  const [customDefs, setCustomDefs] = useState<CustomFieldDef[]>([])
  const [customValues, setCustomValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [duplicate, setDuplicate] = useState<DuplicateLead | null>(null)
  const [checkingPhone, setCheckingPhone] = useState(false)

  const [fullName, setFullName] = useState('')
  const [childName, setChildName] = useState('')
  const [whatsappNumber, setWhatsappNumber] = useState('')
  const [secondPhone, setSecondPhone] = useState('')
  const [email, setEmail] = useState('')
  const [source, setSource] = useState('')
  const [grade, setGrade] = useState('')
  const [location, setLocation] = useState('')
  const [serviceInterestedIn, setServiceInterestedIn] = useState('')
  const [timeline, setTimeline] = useState('')

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        setSession(s)
        if (s?.clientId) setClientId(s.clientId)
      })
    fetch('/api/clients')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        setInstitutes(Array.isArray(data) ? data : [])
        // Deliberately no default. An agency user works across institutes,
        // and quietly pre-selecting whichever sorts first files the lead
        // against the wrong school with no visible mistake to notice.
        // A client user's own clientId is still set above.
      })
  }, [])

  // One lead per phone number is enforced by the API and by a unique index on
  // the table, but finding that out only after filling in the whole form is a
  // waste of the person's time. This checks as they type — debounced, so a
  // ten-digit number is one request rather than ten.
  useEffect(() => {
    const digits = whatsappNumber.replace(/\D/g, '')
    if (digits.length < 10) {
      setDuplicate(null)
      return
    }
    let cancelled = false
    setCheckingPhone(true)
    const t = setTimeout(() => {
      fetch(`/api/leads/check-phone?phone=${encodeURIComponent(whatsappNumber)}`)
        .then((r) => (r.ok ? r.json() : { duplicate: false, lead: null }))
        .then((data) => {
          if (cancelled) return
          setDuplicate(data.duplicate ? data.lead : null)
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setCheckingPhone(false)
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(t)
      setCheckingPhone(false)
    }
  }, [whatsappNumber])

  useEffect(() => {
    if (!clientId) return
    fetch(`/api/option-items?clientId=${clientId}&listKey=lead_source`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setSources(Array.isArray(data) ? data.filter((s: any) => s.is_active) : []))
    fetch(`/api/lead-form-fields?clientId=${clientId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setCustomDefs(Array.isArray(data) ? data.filter((f: CustomFieldDef) => f.is_active) : []))
  }, [clientId])

  const isAgency = session?.role === 'agency_admin' || session?.role === 'agency_staff'

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!fullName.trim() || !whatsappNumber.trim()) return
    // Was a bare `return` alongside the checks above, so with no institute
    // chosen the Save button simply did nothing and gave no reason why.
    if (!clientId) {
      setError('Choose which institution this lead belongs to.')
      return
    }
    if (duplicate) {
      setError(`This number is already on lead #${duplicate.lead_number} — ${duplicate.full_name}.`)
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          fullName,
          childName: childName || undefined,
          whatsappNumber,
          secondPhone: secondPhone || undefined,
          email: email || undefined,
          source: source || 'manual',
          grade: grade || undefined,
          location: location || undefined,
          serviceInterestedIn: serviceInterestedIn || undefined,
          timeline: timeline || undefined,
          customFields: customValues,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || 'Failed to create lead')
        return
      }
      onCreated()
    } catch (err: any) {
      setError(err?.message || 'Network error — could not reach the server')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-card border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-fg">Add Lead</h2>
          <button onClick={onClose} className="text-muted2 hover:text-fg">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={save} className="space-y-4">
          {isAgency && institutes.length > 0 && (
            <div>
              <label className="mb-1 block text-xs text-muted">Institution</label>
              <select
                value={clientId}
                required
                onChange={(e) => setClientId(e.target.value)}
                className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
              >
                <option value="">Select an institution…</option>
                {institutes.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs text-muted">Lead Name *</label>
              <input
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Child Name</label>
              <input
                value={childName}
                onChange={(e) => setChildName(e.target.value)}
                className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">WhatsApp Number *</label>
              <input
                required
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                className={clsx(
                  'w-full rounded-md border bg-card2 px-3 py-2 text-sm text-fg outline-none',
                  duplicate ? 'border-red-500 focus:border-red-500' : 'border-border focus:border-blue-500'
                )}
              />
              {checkingPhone && <p className="mt-1 text-xs text-muted">Checking…</p>}
              {duplicate && (
                <p className="mt-1 text-xs text-red-400">
                  Already on lead #{duplicate.lead_number} — {duplicate.full_name}
                  {duplicate.counsellor_name ? ` (with ${duplicate.counsellor_name})` : ''}. Open that lead instead.
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Second Phone</label>
              <input
                value={secondPhone}
                onChange={(e) => setSecondPhone(e.target.value)}
                className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Source</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
              >
                <option value="">Select source</option>
                {sources.length > 0
                  ? sources.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.value}
                      </option>
                    ))
                  : Object.entries(SOURCE_LABEL).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Child's Class</label>
              <input
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">City</label>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Course</label>
              <input
                value={serviceInterestedIn}
                onChange={(e) => setServiceInterestedIn(e.target.value)}
                className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Joining timeline</label>
              <select
                value={timeline}
                onChange={(e) => setTimeline(e.target.value)}
                className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
              >
                <option value="">Select timeline</option>
                {Object.entries(TIMELINE_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {customDefs.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">Custom Fields</p>
              <div className="grid grid-cols-2 gap-4">
                {customDefs.map((f) =>
                  f.field_type === 'dropdown' ? (
                    <div key={f.field_key}>
                      <label className="mb-1 block text-xs text-muted">{f.label}</label>
                      <select
                        value={customValues[f.field_key] || ''}
                        onChange={(e) => setCustomValues((v) => ({ ...v, [f.field_key]: e.target.value }))}
                        className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
                      >
                        <option value="">—</option>
                        {(f.options || []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div key={f.field_key}>
                      <label className="mb-1 block text-xs text-muted">{f.label}</label>
                      <input
                        type={f.field_type === 'date' ? 'date' : f.field_type === 'time' ? 'time' : f.field_type === 'number' ? 'number' : 'text'}
                        value={customValues[f.field_key] || ''}
                        onChange={(e) => setCustomValues((v) => ({ ...v, [f.field_key]: e.target.value }))}
                        className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
                      />
                    </div>
                  )
                )}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted2 hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !!duplicate}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Add Lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
