'use client'

import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { formatLakh } from '@/lib/format'
import { ClientDashboardMetrics, CampaignRow } from '@/lib/clientDashboardMetrics'

type Tab = 'overall' | 'leads' | 'visited' | 'enrolled'

const PLATFORM_COLOR: Record<string, string> = {
  meta: '#3b82f6', // blue-500
  google: '#22c55e', // green-500
  organic: '#a855f7', // purple-500
}
const PLATFORM_LABEL: Record<string, string> = { meta: 'Meta', google: 'Google', organic: 'Organic' }

interface Bucket {
  leads: number
  visits: number
  enrolled: number
  fees: number
  spend: number
}

function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null
}
function fmtMoney(v: number | null): string {
  return v !== null ? formatLakh(v) : '—'
}
function fmtPct(v: number | null): string {
  return v !== null ? `${Math.round(v)}%` : '—'
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-border bg-card p-4 text-center">
      <p className="text-2xl font-bold text-fg">{value}</p>
      <p className="mt-1 text-xs uppercase tracking-widest text-muted">{label}</p>
    </div>
  )
}

function Donut({ segments, size = 160 }: { segments: { color: string; pct: number }[]; size?: number }) {
  const r = size / 2 - 12
  const c = 2 * Math.PI * r
  let acc = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`translate(${size / 2},${size / 2}) rotate(-90)`}>
        {segments.every((s) => s.pct === 0) ? (
          <circle r={r} fill="none" stroke="#3f3f46" strokeWidth={20} />
        ) : (
          segments
            .filter((s) => s.pct > 0)
            .map((s, i) => {
              const dash = (s.pct / 100) * c
              const el = (
                <circle
                  key={i}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={20}
                  strokeDasharray={`${dash} ${c - dash}`}
                  strokeDashoffset={-((acc / 100) * c)}
                />
              )
              acc += s.pct
              return el
            })
        )}
      </g>
    </svg>
  )
}

interface GroupedCampaignRow {
  memberIds: string[]
  displayName: string
  leads: number
  visits: number
  enrolled: number
  fees: number
  spend: number
  cpl: number | null
  convPct: number | null
}

// Meta happily lets you have several distinct campaigns (different
// campaign_ids) that all share the exact same name — cloned campaigns,
// campaigns recreated after a pause, seasonal re-runs of the same
// creative, etc. Each is tracked separately under the hood (correctly —
// they really are different campaigns with their own spend), but showing
// "Leads - IF - Horamavu - Saved - Aug 26" as three separate rows with 1
// lead each just reads as a bug rather than three genuinely different
// things. Group by name for display; the underlying per-campaign-id
// tracking (and the exclusion checkboxes) still works on the real ids.
function groupCampaignsByName(campaigns: CampaignRow[]): GroupedCampaignRow[] {
  const groups = new Map<string, GroupedCampaignRow>()
  for (const c of campaigns) {
    const key = c.displayName.trim().toLowerCase()
    const existing = groups.get(key)
    if (existing) {
      existing.memberIds.push(c.id)
      existing.leads += c.leads
      existing.visits += c.visits
      existing.enrolled += c.enrolled
      existing.fees += c.fees
      existing.spend += c.spend
    } else {
      groups.set(key, {
        memberIds: [c.id],
        displayName: c.displayName,
        leads: c.leads,
        visits: c.visits,
        enrolled: c.enrolled,
        fees: c.fees,
        spend: c.spend,
        cpl: null,
        convPct: null,
      })
    }
  }
  // Recomputed from the summed totals (a true weighted rate across all
  // merged campaigns), not averaged from each member's own cpl/convPct —
  // averaging separate rates would skew toward whichever campaign happened
  // to have fewer leads.
  return Array.from(groups.values()).map((g) => ({
    ...g,
    cpl: g.leads > 0 ? g.spend / g.leads : null,
    convPct: g.leads > 0 ? (g.enrolled / g.leads) * 100 : null,
  }))
}

function CampaignTable({
  campaigns,
  checked,
  onToggle,
}: {
  campaigns: GroupedCampaignRow[]
  checked: Set<string>
  onToggle: (ids: string[]) => void
}) {
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted">Campaigns &amp; Targeting</p>
      <p className="mb-3 mt-1 text-xs text-muted2">
        Uncheck a campaign to leave it out of every number on this page — useful for boosted posts or one-off
        campaigns you don't want counted.
      </p>
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full text-sm">
          <thead className="bg-card2 text-left text-xs uppercase tracking-widest text-muted">
            <tr>
              <th className="w-8 px-3 py-2.5"></th>
              <th className="px-3 py-2.5">Campaign</th>
              <th className="px-3 py-2.5 text-right">Leads</th>
              <th className="px-3 py-2.5 text-right">Visited</th>
              <th className="px-3 py-2.5 text-right">Enrolled</th>
              <th className="px-3 py-2.5 text-right">Spend</th>
              <th className="px-3 py-2.5 text-right">CPL</th>
              <th className="px-3 py-2.5 text-right">CPA</th>
              <th className="px-3 py-2.5 text-right">Lead→Enrolled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {campaigns.map((c) => {
              const isChecked = c.memberIds.every((id) => checked.has(id))
              return (
                <tr key={c.memberIds.join(',')}>
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => onToggle(c.memberIds)}
                      className="h-4 w-4 rounded border-border"
                    />
                  </td>
                  <td className="px-3 py-2.5 text-fg">
                    <span className="inline-flex items-center gap-1">
                      <ChevronRight size={14} className="text-muted2" />
                      {c.displayName}
                      {c.memberIds.length > 1 && (
                        <span className="ml-1 text-xs text-muted2" title="Meta tracks separate ad sets/ads within the same campaign as distinct entries internally — these are all the same campaign, just different ad variations within it.">
                          ({c.memberIds.length} ad variations)
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-fg">{c.leads}</td>
                  <td className="px-3 py-2.5 text-right text-fg">{c.visits}</td>
                  <td className="px-3 py-2.5 text-right text-fg">{c.enrolled}</td>
                  <td className="px-3 py-2.5 text-right text-fg">{formatLakh(c.spend)}</td>
                  <td className="px-3 py-2.5 text-right text-fg">{fmtMoney(c.cpl)}</td>
                  <td className="px-3 py-2.5 text-right text-fg">{fmtMoney(ratio(c.spend, c.enrolled))}</td>
                  <td className="px-3 py-2.5 text-right text-fg">{c.convPct !== null ? `${c.convPct.toFixed(0)}%` : '—'}</td>
                </tr>
              )
            })}
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted">
                  No campaigns in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PlatformCard({
  platform,
  bucket,
  detailed,
}: {
  platform: string
  bucket: Bucket
  detailed: boolean
}) {
  const cpl = ratio(bucket.spend, bucket.leads)
  const cpv = ratio(bucket.spend, bucket.visits)
  const cpa = ratio(bucket.spend, bucket.enrolled)
  const avgFee = ratio(bucket.fees, bucket.enrolled)
  const roas = ratio(bucket.fees, bucket.spend)

  return (
    <div className="rounded-card border border-border bg-card p-4">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: PLATFORM_COLOR[platform] }} />
        {PLATFORM_LABEL[platform]}
      </p>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted2">Leads</dt>
          <dd className="text-fg">{bucket.leads}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted2">Visited</dt>
          <dd className="text-fg">
            {bucket.visits} {bucket.leads > 0 && <span className="text-muted">({fmtPct(ratio(bucket.visits, bucket.leads) && ratio(bucket.visits, bucket.leads)! * 100)})</span>}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted2">Enrolled</dt>
          <dd className="text-fg">
            {bucket.enrolled} {bucket.leads > 0 && <span className="text-muted">({fmtPct(ratio(bucket.enrolled, bucket.leads) && ratio(bucket.enrolled, bucket.leads)! * 100)})</span>}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted2">Spend</dt>
          <dd className="text-fg">{platform === 'organic' ? '—' : formatLakh(bucket.spend)}</dd>
        </div>
        {detailed && platform !== 'organic' && (
          <>
            <div className="flex justify-between border-t border-border pt-1">
              <dt className="text-muted2">CPL</dt>
              <dd className="text-fg">{fmtMoney(cpl)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted2">Cost / visit</dt>
              <dd className="text-fg">{fmtMoney(cpv)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted2">CPA</dt>
              <dd className="text-fg">{fmtMoney(cpa)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted2">Avg fee / student</dt>
              <dd className="text-fg">{fmtMoney(avgFee)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted2">ROAS</dt>
              <dd className="text-fg">{roas !== null ? `${roas.toFixed(1)}x` : '—'}</dd>
            </div>
          </>
        )}
        {!detailed && platform !== 'organic' && (
          <div className="flex justify-between border-t border-border pt-1">
            <dt className="text-muted2">Cost / enrollment</dt>
            <dd className="text-fg">{fmtMoney(cpa)}</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

export default function PipelineDashboard({ metrics }: { metrics: ClientDashboardMetrics }) {
  const [tab, setTab] = useState<Tab>('overall')
  const [detailed, setDetailed] = useState(true)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  // Toggling a grouped row (possibly several real campaign_ids sharing one
  // display name) moves all of them together — if any are currently
  // included, unchecking excludes the whole group; otherwise it includes
  // the whole group. Keeps the checkbox state unambiguous rather than
  // landing in a half-checked state a single checkbox can't represent.
  function toggleCampaignGroup(ids: string[]) {
    setExcluded((prev) => {
      const next = new Set(prev)
      const allIncluded = ids.every((id) => !next.has(id))
      for (const id of ids) {
        if (allIncluded) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  const includedCampaigns = useMemo(
    () => metrics.campaigns.filter((c) => !excluded.has(c.id)),
    [metrics.campaigns, excluded]
  )

  const buckets = useMemo(() => {
    // Explicit literal keys here, not Record<string, Bucket> — spreading an
    // indexed-signature object below would lose "meta"/"google" as known
    // properties in the inferred type (a real TS quirk, not a runtime bug),
    // which is exactly what broke the build: totals further down couldn't
    // see buckets.meta/buckets.google at all after the spread.
    const byPlatform: { meta: Bucket; google: Bucket } = {
      meta: { leads: 0, visits: 0, enrolled: 0, fees: 0, spend: 0 },
      google: { leads: 0, visits: 0, enrolled: 0, fees: 0, spend: 0 },
    }
    for (const c of includedCampaigns) {
      const key: 'meta' | 'google' = c.platform === 'google' ? 'google' : 'meta'
      byPlatform[key].leads += c.leads
      byPlatform[key].visits += c.visits
      byPlatform[key].enrolled += c.enrolled
      byPlatform[key].fees += c.fees
      byPlatform[key].spend += c.spend
    }
    return { ...byPlatform, organic: metrics.organic }
  }, [includedCampaigns, metrics.organic])

  const totals: Bucket = useMemo(() => {
    const all = [buckets.meta, buckets.google, buckets.organic]
    return all.reduce(
      (acc, b) => ({
        leads: acc.leads + b.leads,
        visits: acc.visits + b.visits,
        enrolled: acc.enrolled + b.enrolled,
        fees: acc.fees + b.fees,
        spend: acc.spend + b.spend,
      }),
      { leads: 0, visits: 0, enrolled: 0, fees: 0, spend: 0 }
    )
  }, [buckets])

  const cpl = ratio(totals.spend, totals.leads)
  const costPerVisit = ratio(totals.spend, totals.visits)
  const cpa = ratio(totals.spend, totals.enrolled)
  const avgFee = ratio(totals.fees, totals.enrolled)
  const roas = ratio(totals.fees, totals.spend)
  const leadToVisit = ratio(totals.visits, totals.leads)
  const visitToEnrolled = ratio(totals.enrolled, totals.visits)
  const leadToEnrolled = ratio(totals.enrolled, totals.leads)

  const donutSegments = (['meta', 'google', 'organic'] as const).map((p) => ({
    color: PLATFORM_COLOR[p],
    pct: totals.enrolled > 0 ? (buckets[p].enrolled / totals.enrolled) * 100 : 0,
  }))

  const metaCampaigns = metrics.campaigns.filter((c) => c.platform !== 'google')
  const googleCampaigns = metrics.campaigns.filter((c) => c.platform === 'google')
  const includedIds = useMemo(() => new Set(includedCampaigns.map((c) => c.id)), [includedCampaigns])

  // Grouped by name for display (see groupCampaignsByName above) — the
  // table shows one row per distinct campaign name, summing however many
  // real campaign_ids share it, rather than one row per campaign_id.
  const groupedMeta = useMemo(() => groupCampaignsByName(metaCampaigns), [metaCampaigns])
  const groupedGoogle = useMemo(() => groupCampaignsByName(googleCampaigns), [googleCampaigns])

  // The tab switch doesn't have a distinct reference design for each of
  // Leads/Visited/Enrolled beyond Overall Pipeline — it re-sorts the
  // campaign tables by that specific metric instead of showing an unseen
  // different layout. Sorting (and the checkbox list itself) always shows
  // every campaign, checked or not — only the totals above exclude an
  // unchecked one, never the table row itself, or there'd be no way to
  // check it back on.
  const sortKey: 'leads' | 'visits' | 'enrolled' | null =
    tab === 'leads' ? 'leads' : tab === 'visited' ? 'visits' : tab === 'enrolled' ? 'enrolled' : null
  const sortedMeta = sortKey ? [...groupedMeta].sort((a, b) => b[sortKey] - a[sortKey]) : groupedMeta
  const sortedGoogle = sortKey ? [...groupedGoogle].sort((a, b) => b[sortKey] - a[sortKey]) : groupedGoogle

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-card p-1.5">
        {(['overall', 'leads', 'visited', 'enrolled'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              'rounded-md px-4 py-2 text-sm font-medium transition-colors',
              tab === t ? 'bg-blue-500 text-white' : 'text-muted2 hover:text-fg'
            )}
          >
            {t === 'overall' ? 'Overall Pipeline' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 pr-2 text-sm text-muted2">
          <input
            type="checkbox"
            checked={detailed}
            onChange={(e) => setDetailed(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Detailed view
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-card border border-border bg-card p-6 text-center">
          <p className="text-4xl font-bold text-fg">{totals.leads}</p>
          <p className="mt-1 text-xs uppercase tracking-widest text-muted">Leads</p>
        </div>
        <div className="rounded-card border border-border bg-card p-6 text-center">
          <p className="text-4xl font-bold text-fg">{totals.visits}</p>
          <p className="mt-1 text-xs uppercase tracking-widest text-muted">Visited</p>
          <p className="mt-1 text-xs text-muted2">{fmtPct(leadToVisit !== null ? leadToVisit * 100 : null)} of leads</p>
        </div>
        <div className="rounded-card border border-border bg-card p-6 text-center">
          <p className="text-4xl font-bold text-fg">{totals.enrolled}</p>
          <p className="mt-1 text-xs uppercase tracking-widest text-muted">Enrolled</p>
          <p className="mt-1 text-xs text-muted2">{fmtPct(leadToEnrolled !== null ? leadToEnrolled * 100 : null)} of leads</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between text-sm text-muted2">
        <span>
          Total ad spend: <span className="font-medium text-fg">{formatLakh(totals.spend)}</span>
        </span>
        <span>
          Fees collected: <span className="font-medium text-fg">{formatLakh(totals.fees)}</span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile label="Cost / lead (CPL)" value={fmtMoney(cpl)} />
        <MetricTile label="Cost / visit" value={fmtMoney(costPerVisit)} />
        <MetricTile label="Cost / acquisition (CPA)" value={fmtMoney(cpa)} />
        <MetricTile label="Avg fee / student" value={fmtMoney(avgFee)} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile label="ROAS" value={roas !== null ? `${roas.toFixed(1)}x` : '—'} />
        <MetricTile label="Lead → Visit" value={fmtPct(leadToVisit !== null ? leadToVisit * 100 : null)} />
        <MetricTile label="Visit → Enrolled" value={fmtPct(visitToEnrolled !== null ? visitToEnrolled * 100 : null)} />
        <MetricTile label="Lead → Enrolled" value={fmtPct(leadToEnrolled !== null ? leadToEnrolled * 100 : null)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="rounded-card border border-border bg-card p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">Platform share — enrolled</p>
          <div className="flex items-center justify-center">
            <Donut segments={donutSegments} />
          </div>
          <div className="mt-3 space-y-1 text-xs">
            {(['meta', 'google', 'organic'] as const).map((p) => (
              <div key={p} className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PLATFORM_COLOR[p] }} />
                  {PLATFORM_LABEL[p]}
                </span>
                <span className="text-fg">
                  {buckets[p].enrolled} · {fmtPct(donutSegments[['meta', 'google', 'organic'].indexOf(p)].pct)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <PlatformCard platform="meta" bucket={buckets.meta} detailed={detailed} />
        <PlatformCard platform="google" bucket={buckets.google} detailed={detailed} />
        <PlatformCard platform="organic" bucket={buckets.organic} detailed={detailed} />
      </div>

      {metaCampaigns.length > 0 && (
        <div className="rounded-card border border-border bg-card p-5">
          <div className="mb-1 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-base font-semibold text-fg">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: PLATFORM_COLOR.meta }} />
              Meta
            </p>
            <p className="text-xs text-muted2">
              {buckets.meta.leads} leads · {buckets.meta.visits} visited · {buckets.meta.enrolled} enrolled ·{' '}
              {formatLakh(buckets.meta.spend)} spent
            </p>
          </div>
          <CampaignTable campaigns={sortedMeta} checked={includedIds} onToggle={toggleCampaignGroup} />
        </div>
      )}

      {googleCampaigns.length > 0 && (
        <div className="rounded-card border border-border bg-card p-5">
          <div className="mb-1 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-base font-semibold text-fg">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: PLATFORM_COLOR.google }} />
              Google
            </p>
            <p className="text-xs text-muted2">
              {buckets.google.leads} leads · {buckets.google.visits} visited · {buckets.google.enrolled} enrolled ·{' '}
              {formatLakh(buckets.google.spend)} spent
            </p>
          </div>
          <CampaignTable campaigns={sortedGoogle} checked={includedIds} onToggle={toggleCampaignGroup} />
        </div>
      )}
    </div>
  )
}
