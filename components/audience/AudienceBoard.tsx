//Re
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Layers, Plus, Radio, Trash2, Users, X } from 'lucide-react'
import { clsx } from 'clsx'
import NotificationBell from '@/components/NotificationBell'

interface Group {
  id: string
  name: string
  description: string | null
  kind: 'filters' | 'manual' | 'source'
  origin: string
  count: number
  created_at: string | null
  created_by_name: string | null
  editable: boolean
}

interface Member {
  id: string
  full_name: string
  whatsapp_number: string
  email: string | null
  pipeline_stage: string
}

// embedded: rendered inside the Broadcasts page, which already has its own
// title and notification bell — repeating them would give the tab two
// headers stacked on top of each other.
export default function AudienceBoard({
  clientId,
  embedded = false,
}: {
  clientId: string
  embedded?: boolean
}) {
  const [sources, setSources] = useState<Group[]>([])
  const [saved, setSaved] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [open, setOpen] = useState<Group | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    // Parsed whether or not the response was ok — a failed request that
    // silently produced empty lists was indistinguishable from an institute
    // with no leads, which is the wrong thing to show somebody twice.
    fetch(`/api/audience?clientId=${clientId}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
      .then(({ ok, body }) => {
        setSources(body?.sources || [])
        setSaved(body?.saved || [])
        setNotice(body?.error || (ok ? '' : 'Could not load audiences.'))
        setLoading(false)
      })
      .catch((err) => {
        setNotice(err?.message || 'Could not reach the server.')
        setLoading(false)
      })
  }, [clientId])

  useEffect(load, [load])

  useEffect(() => {
    if (!open) return
    setMembers([])
    fetch(`/api/audience/${encodeURIComponent(open.id)}?clientId=${clientId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMembers(d?.leads || []))
      .catch(() => {})
  }, [open, clientId])

  async function remove(g: Group) {
    if (!confirm(`Delete the audience "${g.name}"? Broadcasts already sent to it are unaffected.`)) return
    await fetch(`/api/audience/${g.id}?clientId=${clientId}`, { method: 'DELETE' }).catch(() => {})
    setOpen(null)
    load()
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        {embedded ? (
          <p className="text-sm text-muted2">
            Groups you can send a broadcast to. Pick one from the dropdown on the New Broadcast tab.
          </p>
        ) : (
          <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
            <Users size={22} /> Audience
          </h1>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            <Plus size={15} /> New audience
          </button>
          {!embedded && <NotificationBell />}
        </div>
      </div>

      {notice && (
        <p className="mb-4 rounded-card border border-amber-500/40 bg-card p-4 text-sm text-amber-400">{notice}</p>
      )}

      <section className="mb-8">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted">
          <Layers size={14} /> By source
        </h2>
        <p className="mb-3 text-xs text-muted2">
          Built from your leads and kept current on their own — a new source appears here as soon as the first
          lead arrives from it. Nothing to set up, nothing to maintain.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {sources.map((g) => (
            <GroupCard key={g.id} group={g} onOpen={() => setOpen(g)} />
          ))}
          {sources.length === 0 && (
            <p className="col-span-full rounded-card border border-border bg-card p-6 text-center text-sm text-muted">
              {loading
                ? 'Loading…'
                : notice
                ? 'Source audiences could not be loaded — see the message above.'
                : 'No leads with a source recorded yet.'}
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted">
          <Users size={14} /> Custom audiences
        </h2>
        <p className="mb-3 text-xs text-muted2">
          Groups you’ve defined. A <span className="text-fg">live</span> audience re-checks its rules every time
          it’s used; a <span className="text-fg">fixed</span> one keeps the exact people who were in it when it
          was saved.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {saved.map((g) => (
            <GroupCard key={g.id} group={g} onOpen={() => setOpen(g)} />
          ))}
          {saved.length === 0 && (
            <p className="col-span-full rounded-card border border-border bg-card p-6 text-center text-sm text-muted">
              No custom audiences yet.
            </p>
          )}
        </div>
      </section>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-card border border-border bg-card p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-fg">{open.name}</h2>
                <p className="mt-1 text-xs text-muted2">
                  {open.count.toLocaleString()} lead{open.count === 1 ? '' : 's'}
                  {open.kind === 'source'
                    ? ' · updates automatically'
                    : open.kind === 'filters'
                    ? ' · live rules'
                    : ' · fixed list'}
                  {open.created_by_name ? ` · saved by ${open.created_by_name}` : ''}
                </p>
              </div>
              <button onClick={() => setOpen(null)} className="text-muted2 hover:text-fg">
                <X size={20} />
              </button>
            </div>

            <div className="rounded-card border border-border">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-0">
                  <span className="min-w-0 flex-1 truncate text-fg">{m.full_name}</span>
                  <span className="shrink-0 text-xs text-muted2">{m.whatsapp_number}</span>
                </div>
              ))}
              {members.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-muted">Loading members…</p>
              )}
            </div>
            {open.count > members.length && members.length > 0 && (
              <p className="mt-2 text-xs text-muted2">
                Showing the first {members.length} of {open.count.toLocaleString()}.
              </p>
            )}

            <div className="mt-5 flex justify-between gap-2 border-t border-border pt-4">
              {open.editable ? (
                <button
                  onClick={() => remove(open)}
                  className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted2 hover:text-red-400"
                >
                  <Trash2 size={14} /> Delete
                </button>
              ) : (
                <span />
              )}
              {embedded ? (
                <button
                  onClick={() => setOpen(null)}
                  className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
                >
                  <Radio size={15} /> Close and broadcast
                </button>
              ) : (
                <a
                  href="/broadcasts"
                  className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
                >
                  <Radio size={15} /> Broadcast to this
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {creating && (
        <CreateAudience
          clientId={clientId}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            load()
          }}
        />
      )}
    </div>
  )
}

function GroupCard({ group, onOpen }: { group: Group; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="rounded-card border border-border bg-card p-4 text-left transition-colors hover:border-blue-500"
    >
      <p className="text-2xl font-bold text-fg">{group.count.toLocaleString()}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-fg">{group.name}</p>
      <p className="mt-1 line-clamp-2 text-xs text-muted2">{group.description}</p>
      <span
        className={clsx(
          'mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
          group.kind === 'source'
            ? 'bg-emerald-500/15 text-emerald-400'
            : group.kind === 'filters'
            ? 'bg-blue-500/15 text-blue-300'
            : 'bg-card2 text-muted2'
        )}
      >
        {group.kind === 'source' ? 'automatic' : group.kind === 'filters' ? 'live' : 'fixed'}
      </span>
    </button>
  )
}

function CreateAudience({
  clientId,
  onClose,
  onCreated,
}: {
  clientId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<'filters' | 'manual'>('filters')
  const [sourceKeys, setSourceKeys] = useState<string[]>([])
  const [stageKeys, setStageKeys] = useState<string[]>([])
  const [sources, setSources] = useState<{ key: string; label: string }[]>([])
  const [stages, setStages] = useState<{ key: string; label: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/audience?clientId=${clientId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) =>
        setSources(
          (d?.sources || []).map((g: Group) => ({ key: g.id.replace('source:', ''), label: g.name }))
        )
      )
      .catch(() => {})
    fetch(`/api/pipeline-stages?clientId=${clientId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) =>
        setStages(Array.isArray(rows) ? rows.map((s: any) => ({ key: s.key, label: s.label })) : [])
      )
      .catch(() => {})
  }, [clientId])

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  }

  async function save() {
    if (!name.trim()) {
      setError('Give the audience a name.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/audience', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          name,
          description,
          kind,
          filters: { sourceKeys, stageKeys },
        }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Could not save.')
        return
      }
      onCreated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-card border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-fg">New audience</h2>
          <button onClick={onClose} className="text-muted2 hover:text-fg">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-muted">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Instagram enquiries, Class 6 intake…"
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted">Description (optional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-muted">Sources</label>
            <div className="flex flex-wrap gap-1.5">
              {sources.map((s) => (
                <button
                  key={s.key}
                  onClick={() => toggle(sourceKeys, setSourceKeys, s.key)}
                  className={clsx(
                    'rounded-full border px-3 py-1 text-xs',
                    sourceKeys.includes(s.key)
                      ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                      : 'border-border text-muted2 hover:text-fg'
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-muted">Stages</label>
            <div className="flex flex-wrap gap-1.5">
              {stages.map((s) => (
                <button
                  key={s.key}
                  onClick={() => toggle(stageKeys, setStageKeys, s.key)}
                  className={clsx(
                    'rounded-full border px-3 py-1 text-xs',
                    stageKeys.includes(s.key)
                      ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                      : 'border-border text-muted2 hover:text-fg'
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted2">Leave both blank to include every lead.</p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-muted">Keeps up to date?</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: 'filters' as const, title: 'Live', blurb: 'Re-checks the rules every time it’s used.' },
                { key: 'manual' as const, title: 'Fixed', blurb: 'Freezes whoever matches right now.' },
              ]).map((k) => (
                <button
                  key={k.key}
                  onClick={() => setKind(k.key)}
                  className={clsx(
                    'rounded-card border p-3 text-left',
                    kind === k.key ? 'border-blue-500 bg-blue-500/10' : 'border-border bg-card2'
                  )}
                >
                  <p className="text-sm font-semibold text-fg">{k.title}</p>
                  <p className="mt-0.5 text-xs text-muted2">{k.blurb}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm text-muted2 hover:text-fg">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Create audience'}
          </button>
        </div>
      </div>
    </div>
  )
}
