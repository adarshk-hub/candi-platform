// path: components/sms/SmsBroadcastComposer.tsx
'use client'

import { useEffect, useState } from 'react'
import { Send, Users, Search } from 'lucide-react'

interface SmsTemplateRow {
  stage: string
  name: string
  text: string
}

interface AudienceLead {
  id: string
  full_name: string
  child_name: string | null
  whatsapp_number: string
  pipeline_stage: string
}

// Local Octo only: one fixed MSG91 template to many leads. Pick the
// template, then the audience — either chosen right here (stage, source,
// tag, date added; then tick/untick leads, optionally saved as an audience)
// or a saved audience — preview, send. Values are filled from each lead; a lead
// missing one (e.g. no Company Name) is skipped.
export default function SmsBroadcastComposer({ clientId, onSent }: { clientId: string; onSent: () => void }) {
  const [templates, setTemplates] = useState<SmsTemplateRow[]>([])
  const [stages, setStages] = useState<{ key: string; label: string }[]>([])
  const [groups, setGroups] = useState<{ id: string; name: string; count: number }[]>([])
  const [sources, setSources] = useState<{ id: string; name: string; count: number }[]>([])
  const [allTags, setAllTags] = useState<string[]>([])

  const [stage, setStage] = useState('')
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'choose' | 'saved'>('choose')
  const [groupId, setGroupId] = useState('')
  const [selectedStages, setSelectedStages] = useState<string[]>([])
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')
  const [listSearch, setListSearch] = useState('')
  const [saveName, setSaveName] = useState('')
  const [saveMsg, setSaveMsg] = useState('')

  const [leads, setLeads] = useState<AudienceLead[] | null>(null)
  const [count, setCount] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [previewing, setPreviewing] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ sent: number; skipped: number; failed: number; errors: string[] } | null>(null)

  useEffect(() => {
    fetch(`/api/clients/${clientId}/sms-config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setTemplates(d?.templates || []))
      .catch(() => {})
    fetch(`/api/pipeline-stages?clientId=${clientId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((s) => setStages(Array.isArray(s) ? s : []))
      .catch(() => {})
    fetch(`/api/audience?clientId=${clientId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setSources(d?.sources || [])
        setGroups([...(d?.sources || []), ...(d?.saved || [])])
      })
      .catch(() => {})
    fetch(`/api/broadcasts/tags?clientId=${clientId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((t) => setAllTags(Array.isArray(t) ? t : []))
      .catch(() => {})
  }, [clientId])

  function filters() {
    if (mode === 'saved' && groupId) {
      const source = groupId.startsWith('source:') ? [groupId.slice('source:'.length)] : []
      return {
        tags: [],
        tagsMode: 'any',
        stageKeys: [],
        sourceKeys: source,
        groupId: source.length > 0 ? null : groupId,
      }
    }
    return {
      tags: selectedTags,
      tagsMode: 'any',
      stageKeys: selectedStages,
      sourceKeys: selectedSources.map((id) => id.replace(/^source:/, '')),
      createdFrom: createdFrom || null,
      createdTo: createdTo || null,
      groupId: null,
    }
  }

  function resetPreview() {
    setLeads(null)
    setResult(null)
    setSaveMsg('')
  }

  function toggleIn(list: string[], set: (v: string[]) => void, value: string) {
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value])
    resetPreview()
  }

  // Saves the ticked leads as a fixed audience, reusable here and in
  // WhatsApp/Email broadcasts.
  async function saveAudience() {
    if (!saveName.trim() || picked.size === 0) return
    setSaveMsg('')
    const res = await fetch('/api/audience', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, name: saveName.trim(), kind: 'manual', filters: filters(), leadIds: Array.from(picked) }),
    })
    const b = await res.json().catch(() => ({}))
    if (!res.ok) {
      setSaveMsg(b.error || 'Could not save the audience.')
      return
    }
    setSaveMsg(`Saved "${saveName.trim()}" with ${picked.size} leads.`)
    setGroups((prev) => [...prev, { id: b.id, name: saveName.trim(), count: picked.size }])
    setSaveName('')
  }

  async function preview() {
    setPreviewing(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/broadcasts/audience-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, filters: filters() }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Could not load the audience.')
        return
      }
      setLeads(b.leads || [])
      setCount(b.count || 0)
      setTruncated(!!b.truncated)
      setPicked(new Set((b.leads || []).map((l: AudienceLead) => l.id)))
    } finally {
      setPreviewing(false)
    }
  }

  async function send() {
    if (!stage) return setError('Choose a template.')
    if (picked.size === 0) return setError('Select at least one lead.')
    if (!window.confirm(`Send this SMS to ${picked.size} lead${picked.size === 1 ? '' : 's'}?`)) return
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/sms/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, stage, name: name.trim(), leadIds: Array.from(picked) }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Broadcast failed.')
        return
      }
      setResult(b)
    } finally {
      setSending(false)
    }
  }

  const chosen = templates.find((t) => t.stage === stage)
  const needle = listSearch.trim().toLowerCase()
  const visibleLeads = (leads || []).filter(
    (l) =>
      !needle ||
      l.full_name.toLowerCase().includes(needle) ||
      (l.child_name || '').toLowerCase().includes(needle) ||
      l.whatsapp_number.includes(needle)
  )
  const stageLabel = (key: string) => stages.find((s) => s.key === key)?.label || key

  return (
    <div className="space-y-5">
      <div className="rounded-card border border-border bg-card p-5">
        <h2 className="mb-4 text-lg font-bold text-fg">New SMS broadcast</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-muted">Template</label>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            >
              <option value="">Choose a template…</option>
              {templates.map((t) => (
                <option key={t.stage} value={t.stage}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Broadcast name (optional)</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. November follow-up"
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
        </div>
        {chosen && <p className="mt-3 rounded-md bg-card2 px-3 py-2 text-sm text-muted2">{chosen.text}</p>}
        {stage === 'cold' && (
          <p className="mt-2 text-xs text-amber-500">
            lo_cold is promotional: it only delivers 10 AM – 9 PM and does not reach DND numbers.
          </p>
        )}
      </div>

      <div className="rounded-card border border-border bg-card p-5">
        <h3 className="mb-3 flex items-center gap-2 font-semibold text-fg">
          <Users size={16} /> Audience
        </h3>

        <div className="mb-4 flex gap-2">
          {(['choose', 'saved'] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m)
                resetPreview()
              }}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                mode === m ? 'border-blue-500 bg-blue-500/10 text-blue-500' : 'border-border text-muted2 hover:text-fg'
              }`}
            >
              {m === 'choose' ? 'Choose leads here' : 'Saved audience'}
            </button>
          ))}
        </div>

        {mode === 'saved' ? (
          <select
            value={groupId}
            onChange={(e) => {
              setGroupId(e.target.value)
              resetPreview()
            }}
            className="mb-4 w-full max-w-md rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
          >
            <option value="">Choose a saved audience…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.count})
              </option>
            ))}
          </select>
        ) : (
          <div className="mb-4 space-y-4">
            <p className="text-xs text-muted2">
              Narrow down with any of these (nothing picked = all leads), click Preview, then tick or untick leads.
            </p>
            <div>
              <p className="mb-2 text-xs text-muted">Stage</p>
              <div className="flex flex-wrap gap-2">
                {stages.map((st) => (
                  <Chip
                    key={st.key}
                    on={selectedStages.includes(st.key)}
                    label={st.label}
                    onClick={() => toggleIn(selectedStages, setSelectedStages, st.key)}
                  />
                ))}
              </div>
            </div>
            {sources.length > 0 && (
              <div>
                <p className="mb-2 text-xs text-muted">Source</p>
                <div className="flex flex-wrap gap-2">
                  {sources.map((so) => (
                    <Chip
                      key={so.id}
                      on={selectedSources.includes(so.id)}
                      label={`${so.name} (${so.count})`}
                      onClick={() => toggleIn(selectedSources, setSelectedSources, so.id)}
                    />
                  ))}
                </div>
              </div>
            )}
            {allTags.length > 0 && (
              <div>
                <p className="mb-2 text-xs text-muted">Tag (any)</p>
                <div className="flex flex-wrap gap-2">
                  {allTags.map((t) => (
                    <Chip key={t} on={selectedTags.includes(t)} label={t} onClick={() => toggleIn(selectedTags, setSelectedTags, t)} />
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted">Added from</label>
                <input
                  type="date"
                  value={createdFrom}
                  onChange={(e) => {
                    setCreatedFrom(e.target.value)
                    resetPreview()
                  }}
                  className="rounded-md border border-border bg-card2 px-3 py-1.5 text-sm text-fg outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Added to</label>
                <input
                  type="date"
                  value={createdTo}
                  onChange={(e) => {
                    setCreatedTo(e.target.value)
                    resetPreview()
                  }}
                  className="rounded-md border border-border bg-card2 px-3 py-1.5 text-sm text-fg outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        )}

        <button
          onClick={preview}
          disabled={previewing || (mode === 'saved' && !groupId)}
          className="rounded-md border border-border px-4 py-2 text-sm text-fg hover:bg-card2 disabled:opacity-50"
        >
          {previewing ? 'Loading…' : 'Preview Audience'}
        </button>

        {leads && (
          <div className="mt-4">
            <p className="mb-2 text-sm text-muted2">
              {count} lead{count === 1 ? '' : 's'} match · {picked.size} selected
              {truncated && ' · showing the first 500'}
            </p>
            <div className="relative mb-2 w-full max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
                placeholder="Find a lead in this list"
                className="w-full rounded-md border border-border bg-card2 py-1.5 pl-8 pr-3 text-sm text-fg outline-none focus:border-blue-500"
              />
            </div>
            <div className="max-h-80 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card2">
                  <tr className="text-left text-xs uppercase tracking-widest text-muted">
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={picked.size === leads.length && leads.length > 0}
                        onChange={() =>
                          setPicked((prev) => (prev.size === leads.length ? new Set() : new Set(leads.map((l) => l.id))))
                        }
                      />
                    </th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Company</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Stage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleLeads.map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={picked.has(l.id)}
                          onChange={() =>
                            setPicked((prev) => {
                              const next = new Set(prev)
                              if (next.has(l.id)) next.delete(l.id)
                              else next.add(l.id)
                              return next
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-fg">{l.full_name}</td>
                      <td className="px-3 py-2 text-muted2">{l.child_name || '—'}</td>
                      <td className="px-3 py-2 text-muted2">{l.whatsapp_number}</td>
                      <td className="px-3 py-2 text-muted2">{stageLabel(l.pipeline_stage)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {mode === 'choose' && picked.size > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="Save these leads as an audience (name)"
                  className="w-72 rounded-md border border-border bg-card2 px-3 py-1.5 text-sm text-fg outline-none focus:border-blue-500"
                />
                <button
                  onClick={saveAudience}
                  disabled={!saveName.trim()}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:bg-card2 disabled:opacity-50"
                >
                  Save audience
                </button>
                {saveMsg && <span className="text-sm text-muted2">{saveMsg}</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {result && (
        <div className="rounded-card border border-border bg-card p-4 text-sm">
          <p className="text-fg">
            Sent {result.sent} · Skipped {result.skipped} (missing details) · Failed {result.failed}
          </p>
          {result.errors.length > 0 && <p className="mt-1 text-red-400">{result.errors.join(' · ')}</p>}
          <button onClick={onSent} className="mt-3 text-sm text-blue-500 hover:underline">
            See sent SMS →
          </button>
        </div>
      )}

      <button
        onClick={send}
        disabled={sending || !stage || !leads || picked.size === 0}
        className="flex items-center gap-2 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        <Send size={16} />
        {sending ? 'Sending…' : `Send SMS${picked.size ? ` to ${picked.size}` : ''}`}
      </button>
    </div>
  )
}

function Chip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs ${
        on ? 'border-blue-500 bg-blue-500/10 text-blue-500' : 'border-border text-muted2 hover:text-fg'
      }`}
    >
      {label}
    </button>
  )
}
