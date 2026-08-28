'use client'

import { useRef, useState } from 'react'
import { X, Upload, CheckCircle2, AlertTriangle } from 'lucide-react'

interface ImportResult {
  imported: number
  skippedCount: number
  skipped: { row: number; reason: string }[]
  total: number
  message: string
}

export default function LeadImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)

  async function upload() {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/leads/import', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Import failed.')
        setUploading(false)
        return
      }
      setResult(data)
      setUploading(false)
      onImported()
    } catch {
      setError('Import failed. Please try again.')
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-card border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fg">Import Leads</h2>
          <button onClick={onClose} className="text-muted2 hover:text-fg">
            <X size={20} />
          </button>
        </div>

        {!result ? (
          <>
            <p className="mb-4 text-sm text-muted2">
              Upload a .xlsx or .csv file. Each row must have a <strong className="text-fg">Parent Name</strong> and{' '}
              <strong className="text-fg">Phone Number</strong> — rows missing either will be skipped and not
              imported. Optional columns: Child Name, Grade, Source, Stage, Email, Second Phone, Location, Service,
              Occupation, Company, Notes.
            </p>

            <div
              onClick={() => fileInputRef.current?.click()}
              className="mb-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border py-8 text-center hover:border-blue-500"
            >
              <Upload size={24} className="text-muted2" />
              <p className="text-sm text-fg">{file ? file.name : 'Click to choose a file'}</p>
              <p className="text-xs text-muted">.xlsx, .xls or .csv</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>

            {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

            <div className="flex justify-end gap-3">
              <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-muted2 hover:text-fg">
                Cancel
              </button>
              <button
                onClick={upload}
                disabled={!file || uploading}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {uploading ? 'Importing...' : 'Import'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 flex items-start gap-3 rounded-md border border-border bg-card2 p-3">
              {result.skippedCount === 0 ? (
                <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-green-400" />
              ) : (
                <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-400" />
              )}
              <p className="text-sm text-fg">{result.message}</p>
            </div>

            {result.skipped.length > 0 && (
              <div className="mb-4 max-h-52 overflow-y-auto rounded-md border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-card2 text-muted uppercase">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.skipped.map((s, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2 text-muted2">{s.row}</td>
                        <td className="px-3 py-2 text-muted2">{s.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
