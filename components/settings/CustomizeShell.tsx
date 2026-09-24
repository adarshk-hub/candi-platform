// path: components/settings/CustomizeShell.tsx
//Re

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { clsx } from 'clsx'
import LeadDateRangePanel from './panels/LeadDateRangePanel'
import NotificationBell from '@/components/NotificationBell'
import {
  ArrowLeft,
  ListOrdered,
  Tags,
  Snowflake,
  FormInput,
  Users,
  Rows3,
  CalendarRange,
  Mail,
  MessageCircle,
  Radio,
  History,
  Shuffle,
} from 'lucide-react'
import LeadStagesPanel from './panels/LeadStagesPanel'
import OptionListPanel from './panels/OptionListPanel'
import { COLD_REASON_LIST_KEY } from '@/lib/coldReasons'
import LeadFormFieldsPanel from './panels/LeadFormFieldsPanel'
import CounsellorsPanel from './panels/CounsellorsPanel'
import DisplayPrefsPanel from './panels/DisplayPrefsPanel'
import EmailSettingsPanel from './panels/EmailSettingsPanel'
import WhatsAppSettingsPanel from './panels/WhatsAppSettingsPanel'
import ConversionsApiPanel from './panels/ConversionsApiPanel'
import SettingsActivityPanel from './panels/SettingsActivityPanel'
import LeadAssignmentPanel from './panels/LeadAssignmentPanel'
import { sectionsForRole, SettingsSection } from '@/lib/settingsSections'

interface Institute {
  id: string
  name: string
}

const CATEGORIES = [
  { key: 'stages', label: 'Lead Stages', icon: ListOrdered },
  { key: 'lead_source', label: 'Lead Source', icon: Tags },
  // Cold reasons are a per-institute list like Lead Source; without this
  // section the only way to add one was an INSERT in every schema.
  { key: 'cold_reason', label: 'Cold Reasons', icon: Snowflake },
  { key: 'fields', label: 'Lead Form Fields', icon: FormInput },
  { key: 'counsellors', label: 'Counsellors', icon: Users },
  { key: 'assignment', label: 'Lead Assignment', icon: Shuffle },
  { key: 'email', label: 'School Email', icon: Mail },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { key: 'capi', label: 'Conversions API', icon: Radio },
  { key: 'lead_range', label: 'Lead Date Range', icon: CalendarRange },
  { key: 'display', label: 'Display Preferences', icon: Rows3 },
  { key: 'activity', label: 'Activity', icon: History },
] as const

type CategoryKey = (typeof CATEGORIES)[number]['key']

export default function CustomizeShell({
  institutes,
  lockedToClientId,
  showSettingsLink = true,
  role,
}: {
  institutes: Institute[]
  lockedToClientId: string | null
  // Decides which sections appear. Agency sees everything; a client admin
  // sees everything except the three integration screens; a counsellor sees
  // the day-to-day lists only (lib/settingsSections).
  role: string
  // client_admin has no access to /settings itself (agency-only — see
  // app/settings/page.tsx), so for them this breadcrumb would just bounce
  // straight back to this same Customize page. Only show it for roles that
  // actually have somewhere to go back to.
  showSettingsLink?: boolean
}) {
  const [clientId, setClientId] = useState(lockedToClientId || institutes[0]?.id || '')

  // Which panel is open lives in the URL rather than in state, so a reload
  // (or a link pasted to a colleague) lands on the same panel instead of
  // bouncing back to Lead Stages. An unrecognised or missing value falls
  // back to the first category.
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Only the sections this role may open, so a panel it can't use is never
  // drawn — and can't be reached by editing ?panel= in the URL either.
  const allowed = sectionsForRole(role)
  const categories = CATEGORIES.filter((c) => allowed.includes(c.key as SettingsSection))

  const requested = searchParams.get('panel') as CategoryKey | null
  const active: CategoryKey = categories.some((c) => c.key === requested)
    ? (requested as CategoryKey)
    : ((categories[0]?.key || 'stages') as CategoryKey)

  function setActive(key: CategoryKey) {
    // replace, not push: switching panels is changing a view, not
    // navigating, and stacking every click in history would make Back walk
    // through each panel visited before leaving Settings.
    router.replace(`${pathname}?panel=${key}`, { scroll: false })
  }

  if (!clientId) {
    return <p className="text-muted">No institution to customize yet.</p>
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        {showSettingsLink && (
          <Link href="/settings" className="flex items-center gap-1.5 text-sm text-muted2 hover:text-fg">
            <ArrowLeft size={16} /> Settings
          </Link>
        )}
        <h1 className="text-2xl font-bold text-fg">Customize</h1>
        <div className="ml-auto">
          <NotificationBell />
        </div>
      </div>

      {!lockedToClientId && institutes.length > 1 && (
        <div className="mb-6">
          <label className="mb-1 block text-xs uppercase tracking-wide text-muted">Institution</label>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-72 rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
          >
            {institutes.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {categories.map((c) => (
            <button
              key={c.key}
              onClick={() => setActive(c.key)}
              className={clsx(
                'flex w-full items-center gap-2.5 rounded-md border-l-2 px-3 py-2 text-left text-sm transition-colors',
                active === c.key
                  ? 'border-blue-500 bg-blue-500/10 font-medium text-fg'
                  : 'border-transparent text-muted2 hover:bg-card2 hover:text-fg'
              )}
            >
              <c.icon size={16} />
              {c.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {active === 'stages' && <LeadStagesPanel clientId={clientId} />}
          {active === 'lead_source' && <OptionListPanel clientId={clientId} listKey="lead_source" title="Lead Source" />}
          {active === 'cold_reason' && (
            <OptionListPanel clientId={clientId} listKey={COLD_REASON_LIST_KEY} title="Cold Reasons" />
          )}
          {active === 'fields' && <LeadFormFieldsPanel clientId={clientId} />}
          {active === 'counsellors' && <CounsellorsPanel clientId={clientId} />}
          {active === 'assignment' && <LeadAssignmentPanel clientId={clientId} />}
          {active === 'email' && <EmailSettingsPanel clientId={clientId} />}
          {active === 'whatsapp' && <WhatsAppSettingsPanel clientId={clientId} />}
          {active === 'capi' && <ConversionsApiPanel clientId={clientId} />}
          {active === 'lead_range' && <LeadDateRangePanel clientId={clientId} />}
          {active === 'display' && <DisplayPrefsPanel clientId={clientId} />}
          {active === 'activity' && <SettingsActivityPanel clientId={clientId} />}
        </div>
      </div>
    </div>
  )
}
