'use client'

import { useEffect, useState } from 'react'
import { Check, RefreshCw, Send, MessageSquareText, Plus } from 'lucide-react'
import { SEQUENCE_STEPS } from '@/lib/nurtureSequenceSteps'
import { useStages } from '@/lib/StagesContext'
import { NURTURE_TEMPLATE_DEFINITIONS } from '@/lib/nurtureTemplateDefinitions'
import { OPERATIONAL_TEMPLATE_DEFINITIONS } from '@/lib/operationalTemplateDefinitions'
import WhatsAppWalletPanel from './WhatsAppWalletPanel'
import TemplateVariableMapper from '@/components/whatsapp/TemplateVariableMapper'
import { TemplateVariableMapping, normalizeVariableMap, extractVariableTokens, VARIABLE_SOURCE_LABELS } from '@/components/whatsapp/variableFields'

interface TemplateRow {
  id: string
  name: string
  category: string
  language: string
  status: 'pending' | 'approved' | 'rejected'
  rejection_reason: string | null
  submitted_at: string
  approved_at: string | null
  body_text?: string | null
  variable_map?: Record<string, TemplateVariableMapping> | null
}

const STATUS_STYLES: Record<string, string> = {
  approved: 'bg-green-500/10 text-green-400 border-green-500/30',
  pending: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  rejected: 'bg-red-500/10 text-red-400 border-red-500/30',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] || 'border-border text-muted'}`}>
      {status}
    </span>
  )
}

export default function WhatsAppSettingsPanel({ clientId }: { clientId: string }) {
  // Config form state
  const [configured, setConfigured] = useState(false)
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [wabaId, setWabaId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [tokenAlreadySet, setTokenAlreadySet] = useState(false)
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState('')
  const [verified, setVerified] = useState(false)
  const [testPhone, setTestPhone] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  // Templates state
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [seedingOps, setSeedingOps] = useState(false)

  // Custom template form state
  const [customName, setCustomName] = useState('')
  const [customCategory, setCustomCategory] = useState<'MARKETING' | 'UTILITY' | 'AUTHENTICATION'>('UTILITY')
  const [customBody, setCustomBody] = useState('')
  // What each {{n}} in the new template's body should be filled with.
  const [customVariableMap, setCustomVariableMap] = useState<Record<string, TemplateVariableMapping>>({})
  // Editing the mapping of an already-submitted template (id -> draft).
  const [editingVarsId, setEditingVarsId] = useState<string | null>(null)
  const [varsDraft, setVarsDraft] = useState<Record<string, TemplateVariableMapping>>({})
  const [savingVars, setSavingVars] = useState(false)
  // Shown right next to the Save button — the page-level error line sits far
  // above this table, where a failed save would go unnoticed.
  const [varsError, setVarsError] = useState('')
  const [submittingCustom, setSubmittingCustom] = useState(false)

  // Header is optional — 'none' (most templates), 'text' (a static title
  // line, no upload needed), or a media type that requires the sample
  // file to be uploaded to Meta first for a header_handle (see
  // uploadHeaderMedia below) before the template itself can be submitted.
  const [headerType, setHeaderType] = useState<'none' | 'text' | 'image' | 'video' | 'document'>('none')
  const [headerText, setHeaderText] = useState('')
  const [headerFile, setHeaderFile] = useState<File | null>(null)
  const [headerHandle, setHeaderHandle] = useState<string | null>(null)
  const [headerMediaData, setHeaderMediaData] = useState<string | null>(null)
  const [uploadingHeader, setUploadingHeader] = useState(false)

  // Which stage each step is limited to: day_number -> stage key ('' = any)
  const [stageByDay, setStageByDay] = useState<Record<number, string>>({})
  // day_number -> whether this step asks before sending
  const [confirmByDay, setConfirmByDay] = useState<Record<number, boolean>>({})
  const { stagesFor } = useStages()

  // Sequence-step template assignment state: day_number -> template_name
  const [assignments, setAssignments] = useState<Record<number, string>>({})
  const [assignmentsLoading, setAssignmentsLoading] = useState(true)
  const [savingDay, setSavingDay] = useState<number | null>(null)
  // Per-step save result, shown inside the step's own row. The panel-wide
  // error/status lines sit far up the page under the credentials form, so a
  // failed step save was effectively invisible.
  const [rowMsg, setRowMsg] = useState<Record<number, { ok: boolean; text: string }>>({})

  function loadConfig() {
    setLoading(true)
    fetch(`/api/clients/${clientId}/whatsapp-config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.configured) {
          setConfigured(true)
          setPhoneNumberId(data.phoneNumberId || '')
          setWabaId(data.wabaId || '')
          setDisplayPhoneNumber(data.displayPhoneNumber || '')
          setVerified(!!data.verified)
          setTokenAlreadySet(!!data.accessToken)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  function loadTemplates() {
    setTemplatesLoading(true)
    fetch(`/api/templates/${clientId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setTemplates(rows || []))
      .catch(() => {})
      .finally(() => setTemplatesLoading(false))
  }

  // quiet = refresh after a save without swapping the rows for "Loading…"
  function loadAssignments(quiet = false) {
    if (!quiet) setAssignmentsLoading(true)
    fetch(`/api/clients/${clientId}/whatsapp-sequence-templates`)
      .then((r) => (r.ok ? r.json() : []))
      .then(
        (
          rows: {
            day_number: number
            template_name: string
            stage_key?: string | null
            require_confirmation?: boolean
          }[]
        ) => {
        const stageMap: Record<number, string> = {}
        const confirmMap: Record<number, boolean> = {}
        for (const row of rows || []) {
          stageMap[row.day_number] = row.stage_key || ''
          confirmMap[row.day_number] = !!row.require_confirmation
        }
        setStageByDay(stageMap)
        setConfirmByDay(confirmMap)
        const map: Record<number, string> = {}
        for (const row of rows || []) map[row.day_number] = row.template_name
        setAssignments(map)
      })
      .catch(() => {})
      .finally(() => setAssignmentsLoading(false))
  }

  useEffect(() => {
    loadConfig()
    loadTemplates()
    loadAssignments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  async function saveConfig() {
    setSaving(true)
    setError('')
    setStatus('')
    try {
      if (!phoneNumberId || !wabaId || (!accessToken && !tokenAlreadySet)) {
        setError('Phone Number ID, WABA ID, and an access token are required.')
        return
      }
      const body: any = { phoneNumberId, wabaId, displayPhoneNumber }
      if (accessToken) body.accessToken = accessToken

      const res = await fetch(`/api/clients/${clientId}/whatsapp-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setError(b.error || 'Failed to save')
        return
      }
      setAccessToken('')
      setStatus('WhatsApp config saved. Send a test message to verify it before launching sequences.')
      loadConfig()
    } catch (err: any) {
      setError(err?.message || 'Network error — could not reach the server')
    } finally {
      setSaving(false)
    }
  }

  async function verify() {
    if (!testPhone) {
      setError('Enter a phone number to send the test message to (with country code).')
      return
    }
    setVerifying(true)
    setError('')
    setStatus('')
    try {
      const res = await fetch(`/api/clients/${clientId}/verify-whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testPhone }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok || !b.ok) {
        setError(b.error || 'Verification failed — check the access token and phone number ID.')
        return
      }
      setStatus('Test message sent successfully — number is verified.')
      setVerified(true)
    } catch (err: any) {
      setError(err?.message || 'Network error — could not reach the server')
    } finally {
      setVerifying(false)
    }
  }

  // "Check availability" — polls Meta for the latest approval status of
  // every template still pending for this client and refreshes the table.
  async function syncStatus() {
    setSyncing(true)
    setError('')
    setStatus('')
    try {
      const res = await fetch(`/api/templates/sync/${clientId}`, { method: 'POST' })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Could not check template availability with Meta.')
        return
      }
      if (b.errors?.length > 0) {
        const first = b.errors[0]
        setError(
          `Meta couldn't confirm ${b.errors.length} template(s). "${first.name}": ${
            first.metaError?.message || first.reason || 'Unknown error'
          }`
        )
      } else if (b.updated?.length > 0) {
        setStatus(`Checked ${b.updated.length} template(s) — statuses refreshed from Meta.`)
      } else {
        setStatus('No pending templates to check, or Meta still reports them as pending.')
      }
      loadTemplates()
    } catch (err: any) {
      setError(err?.message || 'Network error — could not reach the server')
    } finally {
      setSyncing(false)
    }
  }

  async function seedDefaults() {
    setSeeding(true)
    setError('')
    setStatus('')
    try {
      const res = await fetch(`/api/clients/${clientId}/whatsapp-templates/seed-defaults`, { method: 'POST' })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Failed to submit the default nurture templates.')
        return
      }
      setStatus(`Submitted ${b.templates?.length || 5} nurture templates to Meta as "${b.clientCode}_*". Approval usually takes a few minutes to a day — use "Check availability" to refresh status.`)
      loadTemplates()
    } catch (err: any) {
      setError(err?.message || 'Network error — could not reach the server')
    } finally {
      setSeeding(false)
    }
  }

  async function seedOperational() {
    setSeedingOps(true)
    setError('')
    setStatus('')
    try {
      const res = await fetch(`/api/clients/${clientId}/whatsapp-templates/seed-operational`, { method: 'POST' })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Failed to submit the operational templates.')
        return
      }
      setStatus(`Submitted ${b.templates?.length || 4} operational templates (visit reminders, no-show, post-visit) to Meta as "${b.clientCode}_*".`)
      loadTemplates()
    } catch (err: any) {
      setError(err?.message || 'Network error — could not reach the server')
    } finally {
      setSeedingOps(false)
    }
  }

  // Fires as soon as a file is picked for an image/video/document header.
  // Does two things in parallel: (1) uploads to Meta's Resumable Upload
  // API right away for the one-time approval-submission handle, so the
  // person sees upload success/failure immediately, and (2) reads the
  // same file as base64 to hold in state — that copy is what actually
  // gets persisted with the template and re-uploaded to Meta fresh on
  // every real send later (see lib/metaWhatsapp.ts sendTemplateMessage).
  async function uploadHeaderMedia(file: File) {
    setHeaderFile(file)
    setHeaderHandle(null)
    setHeaderMediaData(null)
    setUploadingHeader(true)
    setError('')
    try {
      const [uploadResult, base64] = await Promise.all([
        (async () => {
          const form = new FormData()
          form.append('file', file)
          const res = await fetch(`/api/clients/${clientId}/templates/upload-media`, { method: 'POST', body: form })
          const b = await res.json().catch(() => ({}))
          if (!res.ok || !b.ok) throw new Error(b.error || 'Failed to upload the sample file to Meta.')
          return b.handle as string
        })(),
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const result = reader.result as string
            // Strip the "data:<mime>;base64," prefix — only the raw
            // base64 payload is stored, mime/filename are kept separately.
            resolve(result.split(',')[1] || '')
          }
          reader.onerror = () => reject(new Error('Could not read the selected file.'))
          reader.readAsDataURL(file)
        }),
      ])
      setHeaderHandle(uploadResult)
      setHeaderMediaData(base64)
    } catch (err: any) {
      setError(err?.message || 'Failed to process the selected file.')
      setHeaderFile(null)
    } finally {
      setUploadingHeader(false)
    }
  }

  // Submits a fully custom template — name, category (Marketing/Utility/
  // Authentication), optional header (text, or image/video/document via
  // an already-uploaded handle), and body text with {{1}}, {{2}}...
  // variables — via the generic POST /api/templates/submit endpoint, same
  // one the two default buttons above call under the hood, just with
  // user-supplied values instead of a fixed definition list.
  // The variable mapping is ours, not Meta's — the approved body text is
  // unchanged — so it can be corrected at any time without resubmitting.
  async function saveVariableMap(templateId: string) {
    setSavingVars(true)
    setVarsError('')
    setError('')
    try {
      const res = await fetch(`/api/templates/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: templateId, variableMap: varsDraft }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setVarsError(b.error || 'Could not save the variable mapping.')
        return
      }
      setEditingVarsId(null)
      loadTemplates()
    } catch (err: any) {
      setVarsError(err?.message || 'Network error — could not reach the server')
    } finally {
      setSavingVars(false)
    }
  }

  async function submitCustomTemplate() {
    if (!customName.trim() || !customBody.trim()) {
      setError('Template name and body are required.')
      return
    }
    if (headerType === 'text' && !headerText.trim()) {
      setError('Enter the header text, or set header type to None.')
      return
    }
    if (headerType !== 'none' && headerType !== 'text' && (!headerHandle || !headerMediaData)) {
      setError('Upload a sample file for the header before submitting.')
      return
    }

    setSubmittingCustom(true)
    setError('')
    setStatus('')
    try {
      const components: any[] = []

      if (headerType === 'text') {
        components.push({ type: 'HEADER', format: 'TEXT', text: headerText.trim() })
      } else if (headerType !== 'none') {
        components.push({
          type: 'HEADER',
          format: headerType.toUpperCase(),
          example: { header_handle: [headerHandle] },
        })
      }

      components.push({ type: 'BODY', text: customBody.trim() })

      const res = await fetch(`/api/templates/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          name: customName.trim(),
          category: customCategory,
          language: 'en',
          components,
          headerFormat: headerType === 'none' ? null : headerType.toUpperCase(),
          headerText: headerType === 'text' ? headerText.trim() : null,
          headerMediaData: headerType !== 'none' && headerType !== 'text' ? headerMediaData : null,
          headerMediaMime: headerFile?.type || null,
          headerMediaFilename: headerFile?.name || null,
          variableMap: customVariableMap,
        }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Failed to submit template.')
        return
      }
      setStatus(`Submitted "${customName.trim()}" (${customCategory}) to Meta for approval.`)
      setCustomName('')
      setCustomBody('')
      setCustomVariableMap({})
      setHeaderType('none')
      setHeaderText('')
      setHeaderFile(null)
      setHeaderHandle(null)
      setHeaderMediaData(null)
      loadTemplates()
    } catch (err: any) {
      setError(err?.message || 'Network error — could not reach the server')
    } finally {
      setSubmittingCustom(false)
    }
  }

  // Reassigns which approved template fires on a given sequence day.
  // Saves immediately on dropdown change (no separate "Save" button per
  // row) since it's a single, low-risk field.
  // stageOverride is passed when the stage dropdown is what changed — the
  // template is re-sent unchanged in that case, because the API stores both
  // on one row and a partial write would blank the other.
  async function assignTemplate(
    dayNumber: number,
    templateName: string,
    stageOverride?: string,
    confirmOverride?: boolean
  ) {
    if (!templateName) return
    setSavingDay(dayNumber)
    setError('')
    setStatus('')
    setRowMsg((prev) => {
      const next = { ...prev }
      delete next[dayNumber]
      return next
    })

    // Snapshot all three fields so a failed save puts back exactly what the
    // database still has. Previously only the template was reverted, so a
    // rejected stage or "Ask first" change stayed on screen looking saved.
    const prevTemplate = assignments[dayNumber]
    const prevStage = stageByDay[dayNumber] || ''
    const prevConfirm = !!confirmByDay[dayNumber]
    const nextStage = stageOverride !== undefined ? stageOverride : prevStage
    const nextConfirm = confirmOverride !== undefined ? confirmOverride : prevConfirm

    setAssignments((prev) => ({ ...prev, [dayNumber]: templateName }))
    setStageByDay((prev) => ({ ...prev, [dayNumber]: nextStage }))
    setConfirmByDay((prev) => ({ ...prev, [dayNumber]: nextConfirm }))

    const revert = (text: string) => {
      setAssignments((prev) => ({ ...prev, [dayNumber]: prevTemplate }))
      setStageByDay((prev) => ({ ...prev, [dayNumber]: prevStage }))
      setConfirmByDay((prev) => ({ ...prev, [dayNumber]: prevConfirm }))
      setRowMsg((prev) => ({ ...prev, [dayNumber]: { ok: false, text } }))
    }

    try {
      const res = await fetch(`/api/clients/${clientId}/whatsapp-sequence-templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayNumber,
          templateName,
          // Meta matches name AND language exactly (#132001 otherwise), so
          // save the language the template was actually approved in.
          languageCode: templates.find((t) => t.name === templateName)?.language || 'en',
          stageKey: nextStage,
          requireConfirmation: nextConfirm,
        }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        revert(b.error || 'Not saved — the server rejected this change.')
        return
      }
      setRowMsg((prev) => ({ ...prev, [dayNumber]: { ok: true, text: 'Saved' } }))
    } catch (err: any) {
      revert(err?.message || 'Not saved — could not reach the server.')
    } finally {
      setSavingDay(null)
      // Re-read what the database actually holds, so the screen can never
      // drift from what the sending code will use.
      loadAssignments(true)
    }
  }

  if (loading) return <p className="text-muted">Loading…</p>

  return (
    <div className="space-y-5">
      <div className="rounded-card border border-border bg-card p-5">
        <h2 className="mb-1 text-lg font-bold text-fg">WhatsApp (Meta Cloud API)</h2>
        <p className="mb-4 text-sm text-muted2">
          Direct to Meta — no AiSensy, no per-client monthly platform fee. Paste the credentials from this
          client&apos;s own WhatsApp Business Account.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs text-muted">Phone Number ID</label>
            <input
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder="1029384756"
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">WhatsApp Business Account (WABA) ID</label>
            <input
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
              placeholder="9182736450"
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Display Phone Number</label>
            <input
              value={displayPhoneNumber}
              onChange={(e) => setDisplayPhoneNumber(e.target.value)}
              placeholder="+91 98201 00000"
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">
              Access Token {tokenAlreadySet && <span className="text-green-400">(already set)</span>}
            </label>
            <input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={tokenAlreadySet ? 'Leave blank to keep current' : 'EAAG...'}
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={saveConfig}
            disabled={saving}
            className="flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
          >
            <Check size={16} /> {saving ? 'Saving…' : 'Save WhatsApp Config'}
          </button>
          {configured && (
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${verified ? STATUS_STYLES.approved : STATUS_STYLES.pending}`}>
              {verified ? 'Verified' : 'Not verified yet'}
            </span>
          )}
        </div>

        {configured && (
          <div className="mt-4 flex items-end gap-2 border-t border-border pt-4">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted">Send a test message to (with country code)</label>
              <input
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="919820100000"
                className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
              />
            </div>
            <button
              onClick={verify}
              disabled={verifying}
              className="flex items-center gap-2 rounded-md border border-border bg-card2 px-4 py-2 text-sm font-medium text-fg hover:bg-card disabled:opacity-50"
            >
              <Send size={14} /> {verifying ? 'Sending…' : 'Send Test & Verify'}
            </button>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {status && <p className="mt-4 text-sm text-green-400">{status}</p>}
      </div>

      <WhatsAppWalletPanel clientId={clientId} />

      <p className="text-xs text-muted2">
        Messages and the sequence schedule now live on the Messages page in the sidebar.
      </p>
    </div>
  )
}
