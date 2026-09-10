// path: components/lead/LeadsPageClient.tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, Plus, List, LayoutGrid, Trash2, Upload, Download, ChevronDown, MessageCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { useNotifications } from '@/lib/useNotifications'
import { LEAD_COLUMNS, LeadColumnKey, resolveLeadColumns } from '@/lib/leadTableColumns'
import { useStages } from '@/lib/StagesContext'
import { SOURCE_LABEL, initials } from '@/lib/types'
import { useColumnWidths } from '@/lib/useColumnWidths'
import ResizableTh from '@/components/ui/ResizableTh'
import LeadSlideOver from '@/components/lead/LeadSlideOver'
import KanbanBoard from '@/components/lead/KanbanBoard'
import ColdReasonModal, { ColdReasonValue } from '@/components/lead/ColdReasonModal'
import AddLeadModal from '@/components/lead/AddLeadModal'
import LeadListFilters, { EMPTY_LEAD_FILTERS, LeadListFilterState } from '@/components/lead/LeadListFilters'
import LeadImportModal from '@/components/lead/LeadImportModal'
import NotificationBell from '@/components/NotificationBell'
import type { LeadRow, LeadsPageResult } from '@/lib/leadsQuery'

const TAB_TITLE: Record<string, string> = {
  warm: 'Warm Leads',
  hot: 'Hot Leads',
  cold: 'Cold Leads',
  enrolled: 'Enrolled',
}

// Widths for every column that can be shown, taken from the shared
// registry so a newly added column arrives with a sensible width instead
// of collapsing to nothing.
const COLUMN_DEFAULTS: Record<string, number> = Object.fromEntries(
  LEAD_COLUMNS.map((c) => [c.key, c.width])
)

const COLUMN_LABELS: Record<string, string> = Object.fromEntries(
  LEAD_COLUMNS.map((c) => [c.key, c.label])
)

// One cell renderer keyed by column, so the header list and the body can
// never disagree about what's on screen — both walk the same array.
function renderCell(
  key: LeadColumnKey,
  l: LeadRow,
  unread: number,
  childHasOwnColumn: boolean,
  onLeadChanged: () => void
) {
  switch (key) {
    case 'id':
      return (
        <>
          <p className="font-mono text-xs text-green-400">#{l.lead_number}</p>
          <p className="text-xs text-muted">
            {new Date(l.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
          </p>
        </>
      )
    case 'lead':
      return (
        <>
          <div className="flex items-center gap-1.5">
            <p className="truncate font-medium text-blue-400">{l.full_name}</p>
            {unread > 0 && (
              <span
                title={`${unread} unread WhatsApp message${unread === 1 ? '' : 's'}`}
                className="flex shrink-0 items-center gap-0.5 rounded-full bg-green-500/15 px-1.5 py-0.5 text-[10px] font-bold text-green-500"
              >
                <MessageCircle size={10} />
                {unread}
              </span>
            )}
          </div>
          {/* Suppressed when Child has a column of its own, otherwise the
              same name would appear twice on every row. */}
          {l.child_name && !childHasOwnColumn && (
            <p className="truncate text-xs text-muted2">{l.child_name}</p>
          )}
        </>
      )
    case 'child_name':
      return <span className="text-muted2">{l.child_name || '—'}</span>
    case 'phone':
      return <span className="text-fg">{l.whatsapp_number}</span>
    case 'email':
      return <span className="text-muted2">{l.email || '—'}</span>
    case 'grade':
      return <span className="text-muted2">{l.grade || '—'}</span>
    case 'stage':
      return <StageCell lead={l} onChanged={onLeadChanged} />
    case 'source':
      return <span className="text-muted2">{SOURCE_LABEL[l.source] || l.source}</span>
    case 'campaign':
      return <span className="text-muted2">{l.campaign_display_name || '—'}</span>
    case 'score':
      return <span className="text-muted2">{l.lead_score ?? 0}/10</span>
    case 'created':
      return (
        <span className="text-muted2">
          {new Date(l.created_at).toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      )
    case 'next_action':
      return <NextActionCell lead={l} />
    case 'counsellor':
      return l.counsellor_name ? (
        <span
          title={l.counsellor_name}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-600 text-xs text-white"
        >
          {initials(l.counsellor_name)}
        </span>
      ) : (
        <span className="text-muted">—</span>
      )
    default:
      return null
  }
}

const TOOLBAR_BTN = 'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted2 hover:bg-card2 hover:text-fg'
const TD = 'truncate border-r border-border px-4 py-3 last:border-r-0'

// Editable in place. Changing a stage was previously a two-step detour —
// open the lead, change it, close it again — for what is the single most
// frequent edit anyone makes on this screen.
//
// The whole cell is the control rather than a small chevron beside the
// pill: the pill is already the thing people point at, and a separate hit
// target next to it would be easy to miss on a dense row.
function StageCell({ lead, onChanged }: { lead: LeadRow; onChanged: () => void }) {
  const { stageLabel, stageColor, stagesFor } = useStages()
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [pendingCold, setPendingCold] = useState<{ key: string; label: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const stages = stagesFor(lead.client_id)

  // The menu is rendered into document.body rather than next to the pill.
  // The leads table sits in an overflow-x-auto wrapper so it can scroll
  // sideways, and any absolutely-positioned child of a scroll container is
  // clipped at its edge — which is why the dropdown appeared cut off or
  // invisible on the rightmost columns and lower rows.
  //
  // A portal escapes that, at the cost of having to position it by hand from
  // the button's own rectangle.
  function openMenu() {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const menuHeight = Math.min(stages.length * 38 + 8, 320)
    // Flip above the pill when there isn't room below, so a row near the
    // bottom of the window doesn't open a menu off-screen.
    const below = window.innerHeight - rect.bottom
    const top = below < menuHeight ? rect.top - menuHeight - 4 : rect.bottom + 4
    setMenuPos({ top, left: rect.left })
    setOpen(true)
  }

  // Position is captured once on open, so scrolling or resizing would leave
  // the menu floating where the pill used to be. Closing is simpler and less
  // surprising than chasing it.
  useEffect(() => {
    if (!open) return
    function close() {
      setOpen(false)
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  async function apply(next: string, coldReason?: ColdReasonValue) {
    setSaving(true)
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pipeline_stage: next,
          cold_reason: coldReason?.reason,
          cold_reason_note: coldReason?.note,
        }),
      })
      if (res.ok) onChanged()
      else {
        const b = await res.json().catch(() => ({}))
        alert(b.error || 'Could not change the stage.')
      }
    } finally {
      setSaving(false)
    }
  }

  function pick(st: { key: string; label: string; status_group: string; is_cold_lane: boolean }) {
    setOpen(false)
    if (st.key === lead.pipeline_stage) return
    // Same rule as everywhere else: a move into a cold stage asks why first,
    // so the cold breakdown on the Activity page stays meaningful.
    if (st.status_group === 'cold' || st.is_cold_lane) setPendingCold({ key: st.key, label: st.label })
    else apply(st.key)
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={(e) => {
          // The row itself opens the lead — without this, changing a stage
          // would also slide the lead panel open behind the menu.
          e.stopPropagation()
          if (open) setOpen(false)
          else openMenu()
        }}
        disabled={saving}
        className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold text-zinc-900 disabled:opacity-60"
        style={{ backgroundColor: stageColor(lead.pipeline_stage, lead.client_id) }}
      >
        {stageLabel(lead.pipeline_stage, lead.client_id)}
        <ChevronDown size={12} />
      </button>

      {open &&
        menuPos &&
        createPortal(
          // React events bubble through the component tree, not the DOM
          // tree — so a click inside this menu still reaches the <tr>'s
          // onClick and opens the lead panel, even though the menu is
          // rendered into document.body. Both the backdrop and the menu
          // stop propagation for that reason; moving the markup out of the
          // row was not enough on its own.
          <>
            <div
              className="fixed inset-0 z-[70]"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
              }}
            />
            <div
              className="fixed z-[71] max-h-80 w-52 overflow-y-auto rounded-card border border-border bg-card2 p-1 shadow-xl"
              style={{ top: menuPos.top, left: menuPos.left }}
              onClick={(e) => e.stopPropagation()}
            >
              {stages.map((st) => (
                <button
                  key={st.key}
                  onClick={(e) => {
                    e.stopPropagation()
                    pick(st)
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-fg hover:bg-card"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: st.color }} />
                  {st.label}
                </button>
              ))}
            </div>
          </>,
          document.body
        )}

      {/* Same reason: the reason modal is a child of this cell, so clicks
          inside it would otherwise open the lead behind it. */}
      {pendingCold && (
        <div onClick={(e) => e.stopPropagation()}>
        <ColdReasonModal
          clientId={lead.client_id}
          stageLabel={pendingCold.label}
          onCancel={() => setPendingCold(null)}
          onConfirm={(value) => {
            const target = pendingCold.key
            setPendingCold(null)
            apply(target, value)
          }}
        />
        </div>
      )}
    </>
  )
}

function NextActionCell({ lead }: { lead: LeadRow }) {
  const action = (lead as any).next_action as string | null
  const dueAt = (lead as any).next_action_at as string | null
  const doneAt = (lead as any).next_action_done_at as string | null

  if (!action) return <span className="text-amber-400">Nothing planned</span>
  if (doneAt) return <span className="text-muted2">{action} · done</span>

  const overdue = !!dueAt && new Date(dueAt) < new Date()
  return (
    <span className={overdue ? 'text-red-400' : 'text-muted2'}>
      {action}
      {dueAt && (
        <span className="ml-1 text-xs">
          · {new Date(dueAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
        </span>
      )}
    </span>
  )
}

export default function LeadsPageClient({ initial }: { initial: LeadsPageResult }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab') || ''
  const page = Number(searchParams.get('page') || '1')
  const view = searchParams.get('view') === 'kanban' ? 'kanban' : 'list'
  // Set by the notification bell when jumping to a specific lead.
  const highlight = searchParams.get('highlight') || ''

  // Per-row unread WhatsApp badges, kept in step with the bell — opening a
  // lead clears it in both places at once.
  const { unreadByLead } = useNotifications()

  function setView(v: 'list' | 'kanban') {
    const params = new URLSearchParams(searchParams.toString())
    if (v === 'kanban') params.set('view', 'kanban')
    else params.delete('view')
    router.push(`/leads?${params.toString()}`)
  }

  // Seeded straight from what the server already fetched during render —
  // this is what removes the "0 leads, then a flash, then real leads"
  // problem: there's real data on screen the instant the page paints, no
  // separate browser round trip required for the first view.
  const [leads, setLeads] = useState<LeadRow[]>(initial.leads)
  const [total, setTotal] = useState(initial.total)
  const [pageSize, setPageSize] = useState(initial.pageSize)
  const [search, setSearch] = useState('')
  const [activeLead, setActiveLead] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [addingLead, setAddingLead] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [filters, setFilters] = useState<LeadListFilterState>(EMPTY_LEAD_FILTERS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const exportMenuRef = useRef<HTMLDivElement>(null)
  // Tracks whether the params this render would fetch for are the exact
  // same ones the server already fetched for — only true on first mount,
  // before any interaction. Skips one wasted round trip for data we
  // already have.
  const isInitialParams = useRef(true)

  const { widths, setWidth } = useColumnWidths('leads-list', COLUMN_DEFAULTS)
  // Starts on the default set so the table renders immediately, then
  // swaps to the institute's saved selection once it loads. resolve*
  // guarantees a usable list either way.
  const [visibleColumns, setVisibleColumns] = useState<LeadColumnKey[]>(() => resolveLeadColumns(null))

  useEffect(() => {
    let cancelled = false
    fetch('/api/lead-table-columns')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setVisibleColumns(resolveLeadColumns(data.columns))
      })
      .catch(() => {
        // Keep the defaults.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Drives the duplicate-suppression in the Lead cell below.
  const showsChildColumn = visibleColumns.includes('child_name')

  function buildQueryParams() {
    const params = new URLSearchParams()
    params.set('page', String(page))
    if (tab) params.set('tab', tab)
    if (search) params.set('search', search)
    if (filters.stage.length) params.set('stage', filters.stage.join(','))
    if (filters.source.length) params.set('source', filters.source.join(','))
    if (filters.grade.length) params.set('grade', filters.grade.join(','))
    return params
  }

  const load = useCallback(() => {
    if (isInitialParams.current) {
      // First render: the server already fetched exactly this data during
      // page render (same tab/page, no search or filters applied yet since
      // those always start empty client-side) — don't re-fetch it.
      isInitialParams.current = false
      return
    }
    setLoading(true)
    const params = buildQueryParams()
    fetch(`/api/leads?${params.toString()}`)
      .then(async (r) => {
        if (r.status === 401) {
          router.push('/login')
          return null
        }
        return r.json()
      })
      .then((data) => {
        if (!data) return
        setLeads(data.leads || [])
        setTotal(data.total || 0)
        setPageSize(data.pageSize || 250)
        setSelected(new Set())
        setLoading(false)
      })
      .catch(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, page, search, filters, router])

  useEffect(load, [load])

  // Arriving from a notification: open that lead straight away. The row
  // itself is also ringed below, which matters when the lead is further
  // down a long list — closing the panel leaves it visibly marked rather
  // than dropping the user into an undifferentiated table.
  useEffect(() => {
    if (highlight) setActiveLead(highlight)
  }, [highlight])

  // Reset to page 1 whenever the filter set changes, so a narrower filter
  // never leaves the user stranded on a page number that no longer exists.
  useEffect(() => {
    if (page !== 1) setPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    if (exportOpen) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [exportOpen])

  function toggleSelectAll() {
    if (selected.size === leads.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(leads.map((l) => l.id)))
    }
  }

  function toggleSelectOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function deleteSelected() {
    if (selected.size === 0) return
    const confirmed = window.confirm(
      `Delete ${selected.size} lead${selected.size === 1 ? '' : 's'}? This cannot be undone.`
    )
    if (!confirmed) return
    setDeleting(true)
    try {
      const res = await fetch('/api/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      })
      if (res.ok) {
        setSelected(new Set())
        load()
      } else {
        const data = await res.json().catch(() => ({}))
        window.alert(data.error || 'Could not delete the selected leads.')
      }
    } finally {
      setDeleting(false)
    }
  }

  function exportLeads(format: 'xlsx' | 'csv') {
    const params = selected.size > 0 ? new URLSearchParams() : buildQueryParams()
    if (selected.size > 0) {
      params.set('ids', Array.from(selected).join(','))
    } else {
      params.delete('page')
    }
    params.set('format', format)
    window.location.href = `/api/leads/export?${params.toString()}`
    setExportOpen(false)
  }

  function setPage(p: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(p))
    router.push(`/leads?${params.toString()}`)
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">{TAB_TITLE[tab] || 'All Leads'}</h1>
          <p className="text-muted2">Total Leads {total}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-4 border-b border-border">
            <button
              onClick={() => setView('list')}
              className={clsx(
                'flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm',
                view === 'list' ? 'border-blue-500 font-medium text-fg' : 'border-transparent text-muted2 hover:text-fg'
              )}
            >
              <List size={14} /> List
            </button>
            <button
              onClick={() => setView('kanban')}
              className={clsx(
                'flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm',
                view === 'kanban' ? 'border-blue-500 font-medium text-fg' : 'border-transparent text-muted2 hover:text-fg'
              )}
            >
              <LayoutGrid size={14} /> Kanban
            </button>
          </div>
          <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                className="w-64 rounded-md border border-border bg-card2 py-2 pl-9 pr-3 text-sm text-fg outline-none focus:border-blue-500"
              />
            </div>
          {/* One filter control for both views — the board reads the same
              stage/source/grade filters, so switching between List and
              Kanban keeps whatever you had narrowed down. */}
          <LeadListFilters value={filters} onChange={setFilters} />
          {/* Import and Export are view-agnostic — they act on the leads
              behind the screen, not on what the screen is drawing — so
              hiding them on the board only meant switching to List and back
              to do something the board had no opinion about. */}
          <button onClick={() => setImporting(true)} className={TOOLBAR_BTN}>
            <Upload size={16} /> Import
          </button>
          <div className="relative" ref={exportMenuRef}>
              <button onClick={() => setExportOpen((o) => !o)} className={TOOLBAR_BTN}>
                <Download size={16} /> Export
                <ChevronDown size={14} />
              </button>
              {exportOpen && (
                <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-md border border-border bg-card p-1 shadow-lg">
                  <p className="px-3 py-1.5 text-xs text-muted">
                    {selected.size > 0 ? `${selected.size} selected` : `All ${total} filtered leads`}
                  </p>
                  <button
                    onClick={() => exportLeads('xlsx')}
                    className="w-full rounded-md px-3 py-2 text-left text-sm text-fg hover:bg-card2"
                  >
                    Export as Excel (.xlsx)
                  </button>
                  <button
                    onClick={() => exportLeads('csv')}
                    className="w-full rounded-md px-3 py-2 text-left text-sm text-fg hover:bg-card2"
                  >
                    Export as CSV (.csv)
                  </button>
                </div>
              )}
          </div>
          <button
            onClick={() => setAddingLead(true)}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            <Plus size={16} /> Add Lead
          </button>
          <NotificationBell />
        </div>
      </div>

      {view === 'kanban' ? (
        <KanbanBoard search={search} filters={filters} />
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between text-sm text-muted2">
            <div className="flex items-center gap-3">
              <span>
                Showing {from} to {to} of {total} leads
              </span>
              {selected.size > 0 && (
                <div className="flex items-center gap-2 rounded-md border border-border bg-card2 px-3 py-1.5">
                  <span className="text-fg">{selected.size} selected</span>
                  <button
                    onClick={deleteSelected}
                    disabled={deleting}
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-red-400 hover:bg-card disabled:opacity-50"
                  >
                    <Trash2 size={14} /> {deleting ? 'Deleting...' : 'Delete'}
                  </button>
                  <button onClick={() => setSelected(new Set())} className="px-2 py-1 text-muted2 hover:text-fg">
                    Clear
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(1)}
                disabled={page <= 1}
                className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40"
              >
                First
              </button>
              <button
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
                className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="px-2 text-fg">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages}
                className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40"
              >
                Next
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages}
                className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40"
              >
                Last
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-card border border-border bg-card">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b border-border bg-card2 text-left text-xs uppercase tracking-wide text-muted">
                  <th className="w-10 border-r border-border px-4 py-3">
                    <input
                      type="checkbox"
                      checked={leads.length > 0 && selected.size === leads.length}
                      onChange={toggleSelectAll}
                      onClick={(e) => e.stopPropagation()}
                      className="h-3.5 w-3.5 rounded border-border accent-blue-600"
                    />
                  </th>
                  {visibleColumns.map((key) => (
                    <ResizableTh key={key} width={widths[key]} onResize={(w) => setWidth(key, w)}>
                      {COLUMN_LABELS[key]}
                    </ResizableTh>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => setActiveLead(l.id)}
                    className={clsx(
                      'cursor-pointer border-b border-border last:border-0 hover:bg-card2',
                      selected.has(l.id) && 'bg-blue-500/5',
                      l.id === highlight && 'bg-amber-400/10 ring-2 ring-inset ring-amber-400/60'
                    )}
                  >
                    <td className="border-r border-border px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(l.id)}
                        onChange={() => toggleSelectOne(l.id)}
                        className="h-3.5 w-3.5 rounded border-border accent-blue-600"
                      />
                    </td>
                    {visibleColumns.map((key) => (
                      <td
                        key={key}
                        style={{ width: widths[key] }}
                        className={clsx(TD, key === 'counsellor' && 'overflow-visible')}
                      >
                        {renderCell(key, l, unreadByLead[l.id] || 0, showsChildColumn, load)}
                      </td>
                    ))}
                  </tr>
                ))}
                {!loading && leads.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-muted">
                      No leads found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {activeLead && (
            <LeadSlideOver
              leadId={activeLead}
              onClose={() => {
                setActiveLead(null)
                if (highlight) {
                  // Otherwise a refresh (or a Back) would re-open the panel
                  // the user just dismissed.
                  const params = new URLSearchParams(searchParams.toString())
                  params.delete('highlight')
                  router.replace(`/leads?${params.toString()}`)
                }
                load()
              }}
            />
          )}
        </>
      )}

      {addingLead && (
        <AddLeadModal
          onClose={() => setAddingLead(false)}
          onCreated={() => {
            setAddingLead(false)
            load()
          }}
        />
      )}

      {importing && (
        <LeadImportModal
          onClose={() => setImporting(false)}
          onImported={() => load()}
        />
      )}
    </div>
  )
}
