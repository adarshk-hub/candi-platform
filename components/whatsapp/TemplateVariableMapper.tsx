// path: components/whatsapp/TemplateVariableMapper.tsx
'use client'

import {
  VARIABLE_SOURCES,
  VARIABLE_SOURCE_LABELS,
  VARIABLE_SUGGESTED_NAMES,
  extractVariableTokens,
  detectVariableFormat,
  sanitizeVariableName,
  isNamedToken,
  TemplateVariableMapping,
  TemplateVariableSource,
  VariableFormat,
} from '@/lib/templateVariableFields'

// Meta approves {{1}} / {{customer}} as bare slots — it has no idea that one
// of them is meant to be the parent's name. This is where the admin says
// what each slot is filled with when the message actually goes out, so a
// counsellor never has to retype it and a broadcast can personalise every
// recipient's copy.
//
// onInsert is optional: when the parent passes it, the "Add variable"
// button appends a new placeholder to the body being written, the same way
// WhatsApp Manager does.
export default function TemplateVariableMapper({
  body,
  value,
  onChange,
  onInsert,
  disabled,
}: {
  body: string
  value: Record<string, TemplateVariableMapping>
  onChange: (next: Record<string, TemplateVariableMapping>) => void
  onInsert?: (placeholder: string) => void
  disabled?: boolean
}) {
  const tokens = extractVariableTokens(body || '')
  // Meta allows one style per template and won't take a mix, so the style
  // follows whatever the body already uses.
  const format: VariableFormat = detectVariableFormat(body || '')

  function set(token: string, patch: Partial<TemplateVariableMapping>) {
    const current = value[token] || { source: 'full_name' as TemplateVariableSource }
    onChange({ ...value, [token]: { ...current, ...patch } })
  }

  function addVariable(style: VariableFormat) {
    if (!onInsert) return
    if (style === 'NUMBER') {
      const nextNumber = tokens.length + 1
      onInsert(`{{${nextNumber}}}`)
      return
    }
    // A name has to be unique within the template and lower-case only.
    let base = 'variable'
    let name = base
    let i = 1
    while (tokens.includes(name)) {
      i += 1
      name = sanitizeVariableName(`${base}_${i}`)
    }
    onInsert(`{{${name}}}`)
  }

  const showPicker = onInsert && tokens.length === 0

  return (
    <div className="mt-3 rounded-md border border-border bg-card2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-fg">Variables</p>
        {onInsert && (
          <div className="flex items-center gap-2">
            {/* Same choice WhatsApp Manager calls "Type of variable". Once
                the body has one, the style is fixed for that template. */}
            {(showPicker || format === 'NUMBER') && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => addVariable('NUMBER')}
                className="rounded-md border border-border bg-card px-2 py-1 text-xs text-fg hover:border-blue-400 disabled:opacity-50"
              >
                + Add number variable
              </button>
            )}
            {(showPicker || format === 'NAME') && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => addVariable('NAME')}
                className="rounded-md border border-border bg-card px-2 py-1 text-xs text-fg hover:border-blue-400 disabled:opacity-50"
              >
                + Add named variable
              </button>
            )}
          </div>
        )}
      </div>

      {tokens.length === 0 ? (
        <p className="mt-1 text-xs text-muted2">
          This message has no variables. Add one to personalise it, or leave it as it is.
        </p>
      ) : (
        <>
          <p className="mb-2 mt-1 text-xs text-muted2">
            {format === 'NAME' ? 'Named' : 'Numbered'} variables. Pick the lead detail each one is replaced with when
            the message is sent, or choose Fixed text to send the same words to everyone.
          </p>
          <div className="space-y-2">
            {tokens.map((token) => {
              const mapping = value[token] || { source: 'full_name' as TemplateVariableSource }
              return (
                <div key={token} className="flex flex-wrap items-center gap-2">
                  <span className="w-32 shrink-0 truncate font-mono text-xs text-muted">{`{{${token}}}`}</span>
                  <select
                    value={mapping.source}
                    disabled={disabled}
                    onChange={(e) => set(token, { source: e.target.value as TemplateVariableSource })}
                    className="rounded-md border border-border bg-card px-2 py-1.5 text-xs text-fg outline-none focus:border-blue-500 disabled:opacity-50"
                  >
                    {VARIABLE_SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {VARIABLE_SOURCE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  <input
                    value={mapping.value || ''}
                    disabled={disabled}
                    onChange={(e) => set(token, { value: e.target.value })}
                    placeholder={
                      mapping.source === 'custom' ? 'Text to send' : 'Fallback if the lead has none (optional)'
                    }
                    className="min-w-[12rem] flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs text-fg outline-none focus:border-blue-500 disabled:opacity-50"
                  />
                </div>
              )
            })}
          </div>
          {format === 'NAME' && (
            <p className="mt-2 text-xs text-muted2">
              Rename a variable by editing it in the message above — lower-case letters, numbers and underscores
              only. Suggested names: {VARIABLE_SOURCES.slice(0, 3).map((s) => VARIABLE_SUGGESTED_NAMES[s]).join(', ')}.
            </p>
          )}
          {tokens.some(isNamedToken) && tokens.some((t) => !isNamedToken(t)) && (
            <p className="mt-2 text-xs text-amber-500">
              Meta won&apos;t accept a mix of named and numbered variables in one template — use one style
              throughout.
            </p>
          )}
        </>
      )}
    </div>
  )
}
