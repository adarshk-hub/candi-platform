// path: components/broadcast/EmailBroadcastComposer.tsx
// path: components/broadcast/EmailBroadcastComposer.tsx
'use client'

import { clsx } from 'clsx'
import { EMAIL_TEMPLATE_PRESETS, findPreset } from '@/lib/emailBroadcastTemplates'

import { useEffect, useState } from 'react'
import { Send, Users, RefreshCw, Tag as TagIcon, AlertTriangle } from 'lucide-react'

interface StageRow {
  key: string
  label: string
  color: string
}

interface AudienceLead {
  id: string
  full_name: string
  child_name: string | null
  email: string | null
  pipeline_stage: string
}

export default function EmailBroadcastComposer({
  clientId,
  instituteName = '',
  onSent,
}: {
  clientId: string
  // Only used to fill the preview's letterhead. The real send reads the
  // institute's name server-side, so a wrong or missing value here can't
  // reach a recipient.
  instituteName?: string
  onSent: () => void
}) {
  const [stages, setStages] = useState<StageRow[]>([])
  const [allTags, setAllTags] = useState<string[]>([])

  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  // Which of the three HTML designs the message is rendered into.
  const [presetKey, setPresetKey] = useState('announcement')
  const [ctaLabel, setCtaLabel] = useState('')
  const [ctaUrl, setCtaUrl] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')
  // Optional label/value rows shown as a bordered panel — "When", "Where",
  // "Bring". Three is the practical maximum before the panel stops being
  // scannable and becomes a table.
  const [details, setDetails] = useState([
    { label: '', value: '' },
    { label: '', value: '' },
    { label: '', value: '' },
  ])

  // A saved or automatic audience, picked instead of building filters by
  // hand. Selecting one replaces the filter panel below — combining a saved
  // group with ad-hoc filters would leave people unsure which of the two the
  // count they're looking at came from.
  const [groupId, setGroupId] = useState('')
  const [groups, setGroups] = useState<{ id: string; name: string; count: number; kind: string }[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagsMode, setTagsMode] = useState<'any' | 'all'>('any')
  const [selectedStages, setSelectedStages] = useState<string[]>([])
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')

  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewSample, setPreviewSample] = useState<AudienceLead[]>([])
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set())
  const [audienceTruncated, setAudienceTruncated] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/pipeline-stages?clientId=${clientId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setStages)
      .catch(() => {})

    fetch(`/api/broadcasts/tags?clientId=${clientId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setAllTags)
      .catch(() => {})

    fetch(`/api/audience?clientId=${clientId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setGroups([...(d?.sources || []), ...(d?.saved || [])]))
      .catch(() => {})

    setPreviewCount(null)
    setPreviewSample([])
    setSelectedTags([])
    setSelectedStages([])
    setGroupId('')
  }, [clientId])

  function currentFilters() {
    // A group carries its own definition, so the hand-built filters are left
    // out entirely rather than ANDed on top — the server resolves the group
    // into whichever rules or fixed member list it stands for.
    if (groupId) {
      const source = groupId.startsWith('source:') ? [groupId.slice('source:'.length)] : []
      return {
        tags: [],
        tagsMode: 'any' as const,
        stageKeys: [],
        createdFrom: null,
        createdTo: null,
        lastContactedFrom: null,
        lastContactedTo: null,
        sourceKeys: source,
        groupId: source.length > 0 ? null : groupId,
      }
    }
    return {
      tags: selectedTags,
      tagsMode,
      stageKeys: selectedStages,
      createdFrom: createdFrom || null,
      createdTo: createdTo || null,
      // Last-contacted filtering removed: it read from a field that is only
      // updated by some channels, so the same lead could be included or
      // excluded depending on how it happened to be contacted.
      lastContactedFrom: null,
      lastContactedTo: null,
      sourceKeys: [],
      groupId: null,
    }
  }

  async function runPreview() {
    setPreviewing(true)
    setError('')
    try {
      // audience-list rather than /preview: /preview returns only a 10-lead
      // sample, which is fine for a count but useless for picking who to
      // exclude. Same endpoint shape the WhatsApp composer uses.
      const res = await fetch('/api/email-broadcasts/audience-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, filters: currentFilters() }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Could not preview audience.')
        return
      }
      setPreviewCount(b.count)
      setPreviewSample(b.leads || [])
      setAudienceTruncated(!!b.truncated)
      // Everyone matched starts selected — "send to everyone matching my
      // filters" is the common case and shouldn't need extra clicks.
      // Unchecking is for hand-excluding a few specific leads.
      setSelectedLeadIds(new Set((b.leads || []).map((l: AudienceLead) => l.id)))
    } catch (err: any) {
      setError(err?.message || 'Network error — could not reach the server')
    } finally {
      setPreviewing(false)
    }
  }

  function toggleLead(id: string) {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedLeadIds((prev) =>
      prev.size === previewSample.length ? new Set() : new Set(previewSample.map((l) => l.id))
    )
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
    setPreviewCount(null)
  }

  function toggleStage(key: string) {
    setSelectedStages((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
    setPreviewCount(null)
  }

  async function send() {
    if (!name.trim() || !subject.trim() || !body.trim()) {
      setError('Broadcast name, subject, and body are required.')
      return
    }
    if (!previewCount) {
      setError('Preview the audience before sending — click "Preview Audience" first.')
      return
    }
    if (selectedLeadIds.size === 0) {
      setError('Select at least one lead to send to.')
      return
    }
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/email-broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          name: name.trim(),
          subject: subject.trim(),
          body,
          // The server rebuilds the HTML rather than trusting what the
          // browser sends: the unsubscribe link has to be per-recipient, so
          // it cannot be baked in here.
          presetKey,
          ctaLabel: ctaLabel.trim() || null,
          ctaUrl: ctaUrl.trim() || null,
          details: details.filter((d) => d.label.trim() && d.value.trim()),
          filters: currentFilters(),
          // The server prefers this over `filters` when present, so an
          // unticked lead is genuinely excluded rather than being re-added
          // by the filters at send time.
          explicitLeadIds: Array.from(selectedLeadIds),
        }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Could not create broadcast.')
        return
      }
      onSent()
    } catch (err: any) {
      setError(err?.message || 'Network error — could not reach the server')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-card border border-border bg-card p-5">
        <h2 className="mb-4 text-lg font-bold text-fg">Message</h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-muted">Broadcast Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Open House Reminder — Aug 2026"
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="You're invited to our Open House"
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Design</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {EMAIL_TEMPLATE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPresetKey(p.key)}
                  className={clsx(
                    'rounded-card border p-3 text-left transition-colors',
                    presetKey === p.key ? 'border-blue-500 bg-blue-500/10' : 'border-border bg-card2 hover:border-blue-500/50'
                  )}
                >
                  <p className="text-sm font-semibold text-fg">{p.name}</p>
                  <p className="mt-0.5 text-xs text-muted2">{p.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="Dear parent,&#10;&#10;We'd love to see you at our Open House this Saturday..."
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
            {/* Typed text, not HTML. It is escaped and turned into
                paragraphs when the template is built — letting raw markup
                through means one stray angle bracket breaks the layout for
                every recipient. */}
            <p className="mt-1 text-xs text-muted2">
              Plain text. Leave a blank line between paragraphs.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted">Details (optional)</label>
            <div className="space-y-2">
              {details.map((d, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={d.label}
                    onChange={(e) =>
                      setDetails((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                    }
                    placeholder={i === 0 ? 'When' : i === 1 ? 'Where' : 'Bring'}
                    className="w-40 rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
                  />
                  <input
                    value={d.value}
                    onChange={(e) =>
                      setDetails((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                    }
                    placeholder={i === 0 ? 'Saturday 14 June, 10am' : i === 1 ? 'Main campus, Gate 2' : ''}
                    className="flex-1 rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
                  />
                </div>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted2">Blank rows are left out.</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted">Button label (optional)</label>
              <input
                value={ctaLabel}
                onChange={(e) => setCtaLabel(e.target.value)}
                placeholder="Book a campus visit"
                className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Button link</label>
              <input
                value={ctaUrl}
                onChange={(e) => setCtaUrl(e.target.value)}
                placeholder="https://yourschool.edu/visit"
                className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const preset = findPreset(presetKey)
                if (!preset) return
                setPreviewHtml(
                  preset.build({
                    institute: instituteName || 'Your school',
                    parentName: 'Priya Sharma',
                    body: body || 'Your message will appear here.',
                    ctaLabel: ctaLabel || undefined,
                    ctaUrl: ctaUrl || undefined,
                    details: details.filter((d) => d.label.trim() && d.value.trim()),
                    // A real-looking link so the footer renders at the right
                    // width; it points nowhere in the preview.
                    unsubscribeUrl: '#',
                  })
                )
              }}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted2 hover:text-fg"
            >
              Preview email
            </button>
            <span className="text-xs text-muted2">Shown with a sample parent name.</span>
          </div>

          {previewHtml && (
            <div className="rounded-card border border-border bg-card2 p-2">
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-xs uppercase tracking-widest text-muted">Preview</p>
                <button onClick={() => setPreviewHtml('')} className="text-xs text-muted2 hover:text-fg">
                  Close
                </button>
              </div>
              {/* An iframe, not dangerouslySetInnerHTML: the email carries
                  its own full document with its own styles, and injecting it
                  into this page would let those styles leak into the app. */}
              <iframe
                title="Email preview"
                srcDoc={previewHtml}
                sandbox=""
                className="h-[420px] w-full rounded-md border border-border bg-white"
              />
            </div>
          )}
        </div>
      </div>

      <div className="rounded-card border border-border bg-card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-fg">
          <Users size={18} /> Audience
        </h2>
        <p className="mb-2 text-sm text-muted2">
          Pick a saved audience, or build one with the filters below (they combine with AND). Only leads with an
          email on file are included either way.
        </p>
        {/* Stated where the recipient count is chosen rather than buried in
            Settings — the moment somebody is about to select 4,000 people is
            the moment the limit is worth knowing. */}
        <p className="mb-4 rounded-md border border-border bg-card2 px-3 py-2 text-xs text-muted2">
          The first <span className="font-semibold text-fg">5,000 emails each month</span> are free. The count
          resets on the 1st.
        </p>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-muted">Audience group</label>
          <select
            value={groupId}
            onChange={(e) => {
              setGroupId(e.target.value)
              setPreviewCount(null)
              setPreviewSample([])
            }}
            className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
          >
            <option value="">Build my own with the filters below</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} — {g.count.toLocaleString()} lead{g.count === 1 ? '' : 's'}
                {g.kind === 'source' ? ' (automatic)' : g.kind === 'manual' ? ' (fixed)' : ''}
              </option>
            ))}
          </select>
          {groupId && (
            <p className="mt-1.5 text-xs text-muted2">
              Using this saved audience — the filters below are ignored.{' '}
              <button
                onClick={() => {
                  setGroupId('')
                  setPreviewCount(null)
                  setPreviewSample([])
                }}
                className="text-blue-400 hover:underline"
              >
                Clear
              </button>
            </p>
          )}
        </div>

        <div className={groupId ? 'pointer-events-none mb-4 opacity-40' : 'mb-4'}>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted">
              <TagIcon size={13} /> Tags
            </label>
            {selectedTags.length > 1 && (
              <div className="flex items-center gap-1 text-xs text-muted2">
                Match
                <select
                  value={tagsMode}
                  onChange={(e) => {
                    setTagsMode(e.target.value as any)
                    setPreviewCount(null)
                  }}
                  className="rounded border border-border bg-card2 px-1 py-0.5 text-xs text-fg"
                >
                  <option value="any">any</option>
                  <option value="all">all</option>
                </select>
                selected tags
              </div>
            )}
          </div>
          {allTags.length === 0 ? (
            <p className="text-xs text-muted">No tags used yet for this institute — add tags from a lead's card first.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                    selectedTags.includes(tag)
                      ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                      : 'border-border bg-card2 text-muted2 hover:text-fg'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-muted">Pipeline Stage</label>
          <div className="flex flex-wrap gap-1.5">
            {stages.map((s) => (
              <button
                key={s.key}
                onClick={() => toggleStage(s.key)}
                style={selectedStages.includes(s.key) ? { borderColor: s.color, color: s.color } : undefined}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                  selectedStages.includes(s.key) ? 'bg-card2' : 'border-border bg-card2 text-muted2 hover:text-fg'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs text-muted">Lead Created Between</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={createdFrom}
                onChange={(e) => {
                  setCreatedFrom(e.target.value)
                  setPreviewCount(null)
                }}
                className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
              />
              <span className="text-xs text-muted2">to</span>
              <input
                type="date"
                value={createdTo}
                onChange={(e) => {
                  setCreatedTo(e.target.value)
                  setPreviewCount(null)
                }}
                className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
          <button
            onClick={runPreview}
            disabled={previewing}
            className="flex items-center gap-2 rounded-md border border-border bg-card2 px-4 py-2 text-sm font-medium text-fg hover:bg-card disabled:opacity-50"
          >
            <RefreshCw size={14} className={previewing ? 'animate-spin' : ''} /> {previewing ? 'Counting…' : 'Preview Audience'}
          </button>
          {previewCount !== null && (
            <span className="text-sm text-fg">
              <strong>{selectedLeadIds.size.toLocaleString()}</strong> of{' '}
              <strong>{previewCount.toLocaleString()}</strong> matching lead
              {previewCount === 1 ? '' : 's'} with email selected
            </span>
          )}
        </div>

        {previewCount !== null && previewCount === 0 && (
          <p className="mt-3 flex items-center gap-2 text-sm text-amber-400">
            <AlertTriangle size={14} /> No leads with an email address match these filters.
          </p>
        )}

        {audienceTruncated && (
          <p className="mt-3 flex items-center gap-2 text-sm text-amber-400">
            <AlertTriangle size={14} /> Too many matches to list individually — narrow the filters to see and
            select from the full match.
          </p>
        )}

        {previewSample.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs font-medium text-fg">
                <input
                  type="checkbox"
                  checked={selectedLeadIds.size === previewSample.length}
                  ref={(el) => {
                    if (el) el.indeterminate = selectedLeadIds.size > 0 && selectedLeadIds.size < previewSample.length
                  }}
                  onChange={toggleSelectAll}
                  className="h-3.5 w-3.5"
                />
                Select all
              </label>
              <span className="text-xs text-muted">Uncheck any lead you want to leave out of this send.</span>
            </div>
            <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-md border border-border bg-card2 p-2">
              {previewSample.map((l) => (
                <li key={l.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-muted2 hover:bg-card">
                    <input
                      type="checkbox"
                      checked={selectedLeadIds.has(l.id)}
                      onChange={() => toggleLead(l.id)}
                      className="h-3.5 w-3.5 shrink-0"
                    />
                    <span className="text-fg">{l.full_name}</span> — {l.email} ({l.pipeline_stage})
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        onClick={send}
        disabled={sending || selectedLeadIds.size === 0}
        className="flex items-center gap-2 rounded-md bg-green-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
      >
        {/* Counts the SELECTION, not the match — after unticking three of
            twenty, the button must not still promise twenty. */}
        <Send size={16} />{' '}
        {sending
          ? 'Queuing…'
          : `Send Broadcast${selectedLeadIds.size ? ` to ${selectedLeadIds.size.toLocaleString()} leads` : ''}`}
      </button>
      <p className="text-xs text-muted2">
        Sends happen gradually in the background via Resend. Replies go to this institute's own email (set in
        Settings → Email) even though the technical sending domain is shared.
      </p>
    </div>
  )
}
