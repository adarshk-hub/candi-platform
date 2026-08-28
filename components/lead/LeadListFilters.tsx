'use client'

import { useEffect, useRef, useState } from 'react'
import { Filter, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { SOURCE_LABEL } from '@/lib/types'

export interface LeadListFilterState {
  stage: string[]
  source: string[]
  grade: string[]
}

export const EMPTY_LEAD_FILTERS: LeadListFilterState = { stage: [], source: [], grade: [] }

interface FilterOptions {
  stages: { key: string; label: string }[]
  sources: string[]
  grades: string[]
}

function Section({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string
  options: { value: string; label: string }[]
  selected: string[]
  onToggle: (value: string) => void
}) {
  if (options.length === 0) return null
  return (
    <div className="border-b border-border py-3 last:border-b-0">
      <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <div className="max-h-48 overflow-y-auto px-1">
        {options.map((opt) => (
          <label
            key={opt.value}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg hover:bg-card2"
          >
            <input
              type="checkbox"
              checked={selected.includes(opt.value)}
              onChange={() => onToggle(opt.value)}
              className="h-3.5 w-3.5 rounded border-border accent-blue-600"
            />
            <span className="truncate">{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

export default function LeadListFilters({
  value,
  onChange,
}: {
  value: LeadListFilterState
  onChange: (v: LeadListFilterState) => void
}) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<FilterOptions>({ stages: [], sources: [], grades: [] })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/leads/filter-options')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setOptions(d))
      .catch(() => {})
  }, [])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const activeCount = value.stage.length + value.source.length + value.grade.length

  function toggle(key: keyof LeadListFilterState, v: string) {
    const current = value[key]
    const next = current.includes(v) ? current.filter((x) => x !== v) : [...current, v]
    onChange({ ...value, [key]: next })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-card2',
          activeCount > 0 ? 'text-blue-400' : 'text-muted2 hover:text-fg'
        )}
      >
        <Filter size={16} /> Filter {activeCount > 0 && `(${activeCount})`}
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-md border border-border bg-card shadow-lg">
          <Section
            title="Stage"
            options={options.stages.map((s) => ({ value: s.key, label: s.label }))}
            selected={value.stage}
            onToggle={(v) => toggle('stage', v)}
          />
          <Section
            title="Source"
            options={options.sources.map((s) => ({ value: s, label: SOURCE_LABEL[s] || s }))}
            selected={value.source}
            onToggle={(v) => toggle('source', v)}
          />
          <Section
            title="Grade"
            options={options.grades.map((g) => ({ value: g, label: g }))}
            selected={value.grade}
            onToggle={(v) => toggle('grade', v)}
          />
          {options.stages.length === 0 && options.sources.length === 0 && options.grades.length === 0 && (
            <p className="px-3 py-4 text-sm text-muted">No filter options yet.</p>
          )}
          {activeCount > 0 && (
            <div className="border-t border-border p-2">
              <button
                onClick={() => onChange(EMPTY_LEAD_FILTERS)}
                className="w-full rounded-md px-2 py-1.5 text-sm text-blue-400 hover:bg-card2"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
