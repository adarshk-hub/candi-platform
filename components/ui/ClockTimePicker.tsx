// path: components/ui/ClockTimePicker.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import { clsx } from 'clsx'

// A clock-face time picker, used in place of the browser's <input type="time">
// (whose scrolling hour/minute lists are hard to use). Pick the hour on the
// dial, then the minute, then AM/PM. Value in/out is "HH:MM" in 24-hour time —
// the same string <input type="time"> gives — so callers don't change.

const SIZE = 224 // dial diameter, px
const RADIUS = 86 // where the numbers sit
const CENTER = SIZE / 2

function parse(value: string): { h12: number; minute: number; pm: boolean } | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(value || '')
  if (!m) return null
  const h = Number(m[1])
  const minute = Number(m[2])
  return { h12: h % 12 === 0 ? 12 : h % 12, minute, pm: h >= 12 }
}

function toValue(h12: number, minute: number, pm: boolean): string {
  const h = (h12 % 12) + (pm ? 12 : 0)
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function label(value: string): string {
  const p = parse(value)
  if (!p) return ''
  return `${p.h12}:${String(p.minute).padStart(2, '0')} ${p.pm ? 'PM' : 'AM'}`
}

// Position on the dial for a given step (0..11, 12 o'clock first).
function pos(step: number) {
  const angle = (step / 12) * 2 * Math.PI - Math.PI / 2
  return { x: CENTER + RADIUS * Math.cos(angle), y: CENTER + RADIUS * Math.sin(angle) }
}

export default function ClockTimePicker({
  value,
  onChange,
  className,
  placeholder = 'Select time',
}: {
  value: string
  onChange: (value: string) => void
  className?: string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'hour' | 'minute'>('hour')
  const [h12, setH12] = useState(10)
  const [minute, setMinute] = useState(0)
  const [pm, setPm] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const dialRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  function openPicker() {
    const p = parse(value)
    if (p) {
      setH12(p.h12)
      setMinute(p.minute)
      setPm(p.pm)
    }
    setMode('hour')
    setOpen(true)
  }

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Turns a pointer position on the dial into an hour (1-12) or minute (0-59, in 5s).
  function pick(clientX: number, clientY: number, finish: boolean) {
    const rect = dialRef.current?.getBoundingClientRect()
    if (!rect) return
    const dx = clientX - (rect.left + rect.width / 2)
    const dy = clientY - (rect.top + rect.height / 2)
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90
    if (deg < 0) deg += 360
    if (mode === 'hour') {
      const h = Math.round(deg / 30) % 12
      setH12(h === 0 ? 12 : h)
      if (finish) setMode('minute')
    } else {
      setMinute((Math.round(deg / 30) % 12) * 5)
    }
  }

  function confirm() {
    onChange(toValue(h12, minute, pm))
    setOpen(false)
  }

  const handStep = mode === 'hour' ? h12 % 12 : Math.round(minute / 5) % 12
  const handEnd = pos(handStep)
  const numbers =
    mode === 'hour'
      ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
      : [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
  const selected = mode === 'hour' ? h12 : minute

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        className={clsx('flex min-w-[8.5rem] items-center justify-between gap-2 text-left', className)}
      >
        <span className={value ? '' : 'text-muted'}>{value ? label(value) : placeholder}</span>
        <Clock size={15} className="text-muted" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[264px] rounded-card border border-border bg-card p-4 shadow-xl">
          {/* Readout: tap hour or minute to switch dials, tap AM/PM to toggle */}
          <div className="mb-3 flex items-center justify-center gap-2">
            <div className="flex items-baseline text-3xl font-semibold tabular-nums">
              <button
                type="button"
                onClick={() => setMode('hour')}
                className={clsx('rounded px-1', mode === 'hour' ? 'text-blue-500' : 'text-muted2 hover:text-fg')}
              >
                {h12}
              </button>
              <span className="text-muted2">:</span>
              <button
                type="button"
                onClick={() => setMode('minute')}
                className={clsx('rounded px-1', mode === 'minute' ? 'text-blue-500' : 'text-muted2 hover:text-fg')}
              >
                {String(minute).padStart(2, '0')}
              </button>
            </div>
            <div className="ml-2 flex flex-col overflow-hidden rounded-md border border-border text-xs font-medium">
              {(['AM', 'PM'] as const).map((p) => {
                const on = (p === 'PM') === pm
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPm(p === 'PM')}
                    className={clsx('px-2 py-1', on ? 'bg-blue-600 text-white' : 'text-muted2 hover:text-fg')}
                  >
                    {p}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Dial */}
          <div
            ref={dialRef}
            className="relative mx-auto select-none rounded-full bg-card2 touch-none"
            style={{ width: SIZE, height: SIZE }}
            onPointerDown={(e) => {
              dragging.current = true
              ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
              pick(e.clientX, e.clientY, false)
            }}
            onPointerMove={(e) => dragging.current && pick(e.clientX, e.clientY, false)}
            onPointerUp={(e) => {
              dragging.current = false
              pick(e.clientX, e.clientY, true)
            }}
          >
            <svg width={SIZE} height={SIZE} className="pointer-events-none absolute inset-0">
              <line x1={CENTER} y1={CENTER} x2={handEnd.x} y2={handEnd.y} stroke="#2563eb" strokeWidth={2} />
              <circle cx={CENTER} cy={CENTER} r={4} fill="#2563eb" />
              <circle cx={handEnd.x} cy={handEnd.y} r={17} fill="#2563eb" />
            </svg>
            {numbers.map((n, i) => {
              const p = pos(i)
              const on = n === selected
              return (
                <span
                  key={n}
                  className={clsx(
                    'pointer-events-none absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center text-sm tabular-nums',
                    on ? 'font-semibold text-white' : 'text-fg'
                  )}
                  style={{ left: p.x, top: p.y }}
                >
                  {mode === 'minute' ? String(n).padStart(2, '0') : n}
                </span>
              )
            })}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
              className="text-sm text-muted2 hover:text-fg"
            >
              Clear
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted2 hover:text-fg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
