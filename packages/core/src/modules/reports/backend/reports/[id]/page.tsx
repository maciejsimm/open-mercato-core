"use client"

import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Play, Save, Trash2, ArrowLeft } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'

type ReportType = 'flat_list' | 'grouped' | 'pivot' | 'chart' | 'summary'

type FilterShape = Record<string, unknown>

type SortShape = { field: string; dir: 'asc' | 'desc' }

type FlatListDefinition = {
  type: 'flat_list'
  fields: string[]
  filters: FilterShape[]
  sort: SortShape[]
  limit?: number
}

type ReportDetail = {
  id: string
  name: string
  description: string | null
  type: ReportType
  datasetId: string
  folderId: string
  permission: 'view' | 'edit'
  definition: unknown
  parameters: unknown
  version: number
  lastExecutedAt: string | null
  updatedAt: string | null
}

type DatasetFieldRow = {
  key: string
  labelKey: string
  kind: string
  sortable?: boolean
  filterable?: boolean
}

type DatasetDetail = {
  id: string
  moduleId: string
  labelKey: string
  entityType: string
  fields: DatasetFieldRow[]
  hiddenFieldPaths?: string[]
}

type ReportRunResponse = {
  mode?: 'sync' | 'async'
  rows?: Array<Record<string, unknown>>
  total?: number
  meta?: { fields?: string[] }
  error?: { code?: string; message?: string }
}

function parseFlatListDefinition(value: unknown): FlatListDefinition {
  if (value && typeof value === 'object' && (value as { type?: unknown }).type === 'flat_list') {
    const raw = value as Partial<FlatListDefinition>
    const fields = Array.isArray(raw.fields) ? raw.fields.filter((f): f is string => typeof f === 'string' && f.length > 0) : []
    const filters = Array.isArray(raw.filters) ? (raw.filters as FilterShape[]) : []
    const sort: SortShape[] = Array.isArray(raw.sort)
      ? (raw.sort as SortShape[])
          .filter((s): s is SortShape => !!s && typeof s === 'object' && typeof (s as SortShape).field === 'string')
          .map((s) => ({ field: s.field, dir: s.dir === 'desc' ? 'desc' as const : 'asc' as const }))
      : []
    return {
      type: 'flat_list',
      fields,
      filters,
      sort,
      limit: typeof raw.limit === 'number' && raw.limit > 0 ? raw.limit : undefined,
    }
  }
  return { type: 'flat_list', fields: [], filters: [], sort: [] }
}

export default function ReportDetailPage() {
  const params = useParams() as { id?: string }
  const router = useRouter()
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const reportId = params?.id ? String(params.id) : ''

  const [report, setReport] = React.useState<ReportDetail | null>(null)
  const [dataset, setDataset] = React.useState<DatasetDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [definition, setDefinition] = React.useState<FlatListDefinition>({ type: 'flat_list', fields: [], filters: [], sort: [] })
  const [isSaving, setIsSaving] = React.useState(false)
  const [isRunning, setIsRunning] = React.useState(false)
  const [isDirty, setIsDirty] = React.useState(false)
  const [runResult, setRunResult] = React.useState<ReportRunResponse | null>(null)

  React.useEffect(() => {
    if (!reportId) return
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const params = new URLSearchParams({ id: reportId, pageSize: '1' })
        const reportCall = await apiCall<{ items?: ReportDetail[] }>(
          `/api/reports/reports?${params.toString()}`,
          undefined,
          { fallback: { items: [] } },
        )
        if (cancelled) return
        if (!reportCall.ok) {
          setLoadError(t('reports.detail.error.load', 'Failed to load report.'))
          return
        }
        const items = Array.isArray(reportCall.result?.items) ? reportCall.result!.items! : []
        const found = items[0]
        if (!found) {
          setLoadError(t('reports.detail.error.notFound', 'Report not found or not visible.'))
          return
        }
        setReport(found)
        setName(found.name)
        setDescription(found.description ?? '')
        setDefinition(parseFlatListDefinition(found.definition))

        const datasetCall = await apiCall<DatasetDetail>(
          `/api/reports/datasets/${encodeURIComponent(found.datasetId)}`,
        )
        if (cancelled) return
        if (datasetCall.ok && datasetCall.result) {
          setDataset(datasetCall.result)
        } else {
          setLoadError(t('reports.detail.error.datasetLoad', 'Failed to load dataset.'))
        }
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : t('reports.detail.error.load', 'Failed to load report.')
        setLoadError(message)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [reportId, t])

  const datasetFields = dataset?.fields ?? []
  const sortableFields = React.useMemo(
    () => datasetFields.filter((field) => field.sortable !== false),
    [datasetFields],
  )

  const canEdit = report?.permission === 'edit'

  const handleFieldToggle = React.useCallback((key: string) => {
    if (!canEdit) return
    setDefinition((prev) => {
      const exists = prev.fields.includes(key)
      const nextFields = exists ? prev.fields.filter((f) => f !== key) : [...prev.fields, key]
      return { ...prev, fields: nextFields }
    })
    setIsDirty(true)
  }, [canEdit])

  const handleSortFieldChange = React.useCallback((value: string) => {
    if (!canEdit) return
    setDefinition((prev) => {
      if (!value) return { ...prev, sort: [] }
      const dir = prev.sort[0]?.dir === 'desc' ? 'desc' as const : 'asc' as const
      return { ...prev, sort: [{ field: value, dir }] }
    })
    setIsDirty(true)
  }, [canEdit])

  const handleSortDirChange = React.useCallback((value: 'asc' | 'desc') => {
    if (!canEdit) return
    setDefinition((prev) => {
      const sortField = prev.sort[0]?.field
      if (!sortField) return prev
      return { ...prev, sort: [{ field: sortField, dir: value }] }
    })
    setIsDirty(true)
  }, [canEdit])

  const handleLimitChange = React.useCallback((raw: string) => {
    if (!canEdit) return
    setDefinition((prev) => {
      if (!raw.trim()) return { ...prev, limit: undefined }
      const parsed = Number(raw)
      if (!Number.isFinite(parsed) || parsed <= 0) return prev
      return { ...prev, limit: Math.min(Math.floor(parsed), 100_000) }
    })
    setIsDirty(true)
  }, [canEdit])

  const handleSave = React.useCallback(async () => {
    if (!report || !canEdit) return
    if (definition.fields.length === 0) {
      flash(t('reports.detail.error.noFields', 'Pick at least one field before saving.'), 'error')
      return
    }
    setIsSaving(true)
    try {
      await apiCallOrThrow('/api/reports/reports', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: report.id,
          name: name.trim() || report.name,
          description: description.trim() ? description.trim() : null,
          definition,
          version: report.version,
        }),
      })
      flash(t('reports.detail.success.save', 'Report saved.'), 'success')
      setIsDirty(false)
      setReport((prev) => prev ? { ...prev, name: name.trim() || prev.name, description: description.trim() || null, definition, version: prev.version + 1 } : prev)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('reports.detail.error.save', 'Failed to save report.')
      flash(message, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [canEdit, definition, description, name, report, t])

  const handleRun = React.useCallback(async () => {
    if (!report) return
    if (isDirty) {
      const confirmed = await confirm({
        title: t('reports.detail.run.unsavedConfirm', 'You have unsaved changes. Run the saved version anyway?'),
        variant: 'destructive',
      })
      if (!confirmed) return
    }
    setIsRunning(true)
    setRunResult(null)
    try {
      const result = await readApiResultOrThrow<ReportRunResponse>(
        `/api/reports/reports/${encodeURIComponent(report.id)}/run`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'sync' }),
        },
      )
      setRunResult(result ?? null)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('reports.detail.error.run', 'Failed to run report.')
      flash(message, 'error')
    } finally {
      setIsRunning(false)
    }
  }, [confirm, isDirty, report, t])

  const handleDelete = React.useCallback(async () => {
    if (!report || !canEdit) return
    const confirmed = await confirm({
      title: t('reports.detail.delete.confirm', 'Delete report "{name}"?').replace('{name}', report.name),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await apiCallOrThrow(`/api/reports/reports?id=${encodeURIComponent(report.id)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
      })
      flash(t('reports.detail.success.delete', 'Report deleted.'), 'success')
      router.push('/backend/reports')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('reports.detail.error.delete', 'Failed to delete report.')
      flash(message, 'error')
    }
  }, [canEdit, confirm, report, router, t])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex items-center justify-center py-16">
            <Spinner />
          </div>
        </PageBody>
      </Page>
    )
  }

  if (loadError || !report) {
    return (
      <Page>
        <PageBody>
          <div className="rounded-md border border-status-error-border bg-status-error-bg px-4 py-6">
            <p className="text-sm text-status-error-text">{loadError ?? t('reports.detail.error.notFound', 'Report not found.')}</p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href="/backend/reports">
                <ArrowLeft className="size-4" aria-hidden />
                <span>{t('reports.detail.actions.backToList', 'Back to reports')}</span>
              </Link>
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  const sortField = definition.sort[0]?.field ?? ''
  const sortDir = (definition.sort[0]?.dir ?? 'asc') as 'asc' | 'desc'
  const renderedRows = Array.isArray(runResult?.rows) ? runResult!.rows! : []
  const renderedColumns = runResult?.meta?.fields && runResult.meta.fields.length
    ? runResult.meta.fields
    : (renderedRows[0] ? Object.keys(renderedRows[0]) : definition.fields)

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button asChild variant="ghost" size="sm">
                <Link href="/backend/reports">
                  <ArrowLeft className="size-4" aria-hidden />
                  <span>{t('reports.detail.actions.backToList', 'Back to reports')}</span>
                </Link>
              </Button>
              <div>
                <h1 className="text-xl font-semibold text-foreground">{report.name}</h1>
                <p className="text-xs text-muted-foreground">
                  {t('reports.detail.metaLine', '{type} · {dataset}')
                    .replace('{type}', t(`reports.list.types.${report.type}`, report.type))
                    .replace('{dataset}', report.datasetId)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={handleRun} disabled={isRunning}>
                <Play className="size-4" aria-hidden />
                <span>{isRunning ? t('reports.detail.actions.running', 'Running…') : t('reports.detail.actions.run', 'Run')}</span>
              </Button>
              {canEdit ? (
                <Button type="button" onClick={handleSave} disabled={isSaving || !isDirty}>
                  <Save className="size-4" aria-hidden />
                  <span>{isSaving ? t('reports.detail.actions.saving', 'Saving…') : t('reports.detail.actions.save', 'Save')}</span>
                </Button>
              ) : null}
              {canEdit ? (
                <Button type="button" variant="destructive" onClick={handleDelete}>
                  <Trash2 className="size-4" aria-hidden />
                  <span>{t('reports.detail.actions.delete', 'Delete')}</span>
                </Button>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="space-y-3 rounded-md border border-border bg-card p-4 lg:col-span-1">
              <h2 className="text-overline text-muted-foreground">{t('reports.detail.sections.metadata', 'Metadata')}</h2>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.fields.name', 'Name')}</span>
                <Input
                  value={name}
                  onChange={(e) => { setName(e.target.value); setIsDirty(true) }}
                  disabled={!canEdit || isSaving}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.fields.description', 'Description')}</span>
                <Textarea
                  value={description}
                  onChange={(e) => { setDescription(e.target.value); setIsDirty(true) }}
                  disabled={!canEdit || isSaving}
                  rows={3}
                />
              </label>
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.fields.dataset', 'Dataset')}</span>
                <p className="font-mono text-sm">{report.datasetId}</p>
              </div>
            </section>

            <section className="space-y-3 rounded-md border border-border bg-card p-4 lg:col-span-2">
              <div className="flex items-center justify-between">
                <h2 className="text-overline text-muted-foreground">{t('reports.detail.sections.fields', 'Fields')}</h2>
                <span className="text-xs text-muted-foreground">
                  {t('reports.detail.fields.selectedCount', '{selected} of {total} selected')
                    .replace('{selected}', String(definition.fields.length))
                    .replace('{total}', String(datasetFields.length))}
                </span>
              </div>
              {datasetFields.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('reports.detail.fields.empty', 'No fields available for this dataset.')}</p>
              ) : (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {datasetFields.map((field) => {
                    const selected = definition.fields.includes(field.key)
                    return (
                      <li key={field.key}>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => handleFieldToggle(field.key)}
                          disabled={!canEdit}
                          aria-pressed={selected}
                          className={cn(
                            'h-auto w-full items-center justify-between px-3 py-2 text-left text-sm',
                            selected ? 'border-primary bg-primary/10 text-foreground hover:bg-primary/15' : '',
                          )}
                        >
                          <span className="flex flex-col items-start gap-0.5">
                            <span className="font-medium">{t(field.labelKey, field.key)}</span>
                            <span className="font-mono text-xs text-muted-foreground">{field.key} · {field.kind}</span>
                          </span>
                          {selected ? (
                            <span className="text-xs font-medium text-primary">✓</span>
                          ) : null}
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              )}

              <div className="grid gap-3 pt-2 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.fields.sortField', 'Sort by')}</span>
                  <select
                    value={sortField}
                    onChange={(e) => handleSortFieldChange(e.target.value)}
                    disabled={!canEdit || isSaving}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">{t('reports.detail.fields.sortNone', 'No sort')}</option>
                    {sortableFields.map((field) => (
                      <option key={field.key} value={field.key}>{t(field.labelKey, field.key)} ({field.key})</option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.fields.sortDir', 'Direction')}</span>
                  <select
                    value={sortDir}
                    onChange={(e) => handleSortDirChange(e.target.value as 'asc' | 'desc')}
                    disabled={!canEdit || isSaving || !sortField}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="asc">{t('reports.detail.fields.sortAsc', 'Ascending')}</option>
                    <option value="desc">{t('reports.detail.fields.sortDesc', 'Descending')}</option>
                  </select>
                </label>
                <label className="block space-y-1 sm:col-span-2">
                  <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.fields.limit', 'Row limit')}</span>
                  <Input
                    type="number"
                    min={1}
                    max={100000}
                    value={definition.limit ?? ''}
                    onChange={(e) => handleLimitChange(e.target.value)}
                    disabled={!canEdit || isSaving}
                    placeholder={t('reports.detail.fields.limitPlaceholder', 'No limit')}
                  />
                </label>
              </div>
            </section>
          </div>

          <section className="rounded-md border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-overline text-muted-foreground">{t('reports.detail.sections.preview', 'Preview')}</h2>
              <span className="text-xs text-muted-foreground">
                {runResult?.total != null
                  ? t('reports.detail.preview.rowCount', '{count} rows').replace('{count}', String(runResult.total))
                  : t('reports.detail.preview.notRun', 'Click "Run" to execute this report.')}
              </span>
            </div>
            {isRunning ? (
              <div className="flex items-center justify-center py-8">
                <Spinner />
              </div>
            ) : renderedRows.length === 0 ? (
              <p className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                {runResult ? t('reports.detail.preview.empty', 'The report returned no rows.') : t('reports.detail.preview.notRun', 'Click "Run" to execute this report.')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {renderedColumns.map((col) => (
                        <th key={col} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {renderedRows.map((row, index) => (
                      <tr key={index} className="border-b border-border/60 last:border-b-0">
                        {renderedColumns.map((col) => {
                          const value = row[col]
                          let display: string
                          if (value == null) display = '—'
                          else if (typeof value === 'object') display = JSON.stringify(value)
                          else display = String(value)
                          return (
                            <td key={col} className="px-3 py-2 align-top">{display}</td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
