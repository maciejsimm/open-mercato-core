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
import { ArrowLeft, Play, Save, Trash2, Plus, X } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'

type Aggregation = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max'
type ReportType = 'flat_list' | 'grouped' | 'pivot' | 'chart' | 'summary'
type ChartType = 'bar' | 'line' | 'pie' | 'donut' | 'area' | 'scatter' | 'combo'

type MeasureExpr = { field: string; aggregation: Aggregation; alias?: string }
type SortShape = { field: string; dir: 'asc' | 'desc' }
type FilterShape = Record<string, unknown>
type ChartSpec = {
  type: ChartType
  xField: string
  yFields: string[]
  stacked?: boolean
  showLegend?: boolean
}

type FlatListDef = {
  type: 'flat_list'
  fields: string[]
  filters: FilterShape[]
  sort: SortShape[]
  limit?: number
}
type GroupedDef = {
  type: 'grouped'
  fields: string[]
  groupBy: string[]
  measures: MeasureExpr[]
  filters: FilterShape[]
  sort: SortShape[]
  limit?: number
}
type PivotDef = {
  type: 'pivot'
  rows: string[]
  cols: string[]
  value: MeasureExpr | null
  filters: FilterShape[]
}
type ChartDef = {
  type: 'chart'
  chart: ChartSpec
  filters: FilterShape[]
  groupBy: string[]
  measures: MeasureExpr[]
  limit?: number
}
type SummaryDef = {
  type: 'summary'
  measures: MeasureExpr[]
  filters: FilterShape[]
}

type Definition = FlatListDef | GroupedDef | PivotDef | ChartDef | SummaryDef

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
  aggregations?: Aggregation[]
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

const NUMERIC_KINDS = new Set(['integer', 'float', 'money'])
const CATEGORICAL_KINDS = new Set(['id', 'text', 'enum', 'boolean', 'fk', 'custom_field', 'date', 'datetime'])
const ALL_AGGREGATIONS: Aggregation[] = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max']
const NON_NUMERIC_AGGREGATIONS: Aggregation[] = ['count', 'count_distinct']
const CHART_TYPES: ChartType[] = ['bar', 'line', 'pie', 'donut', 'area', 'scatter', 'combo']

function isFieldNumeric(field: DatasetFieldRow): boolean {
  if (NUMERIC_KINDS.has(field.kind)) return true
  if (field.kind === 'custom_field') {
    return Array.isArray(field.aggregations) && field.aggregations.some((a) => !NON_NUMERIC_AGGREGATIONS.includes(a))
  }
  return false
}

function isFieldCategorical(field: DatasetFieldRow): boolean {
  return CATEGORICAL_KINDS.has(field.kind)
}

function fieldAllowedAggregations(field: DatasetFieldRow): Aggregation[] {
  if (Array.isArray(field.aggregations) && field.aggregations.length > 0) return [...field.aggregations]
  if (isFieldNumeric(field)) return [...ALL_AGGREGATIONS]
  return [...NON_NUMERIC_AGGREGATIONS]
}

function measureAlias(m: MeasureExpr): string {
  if (m.alias && m.alias.trim()) return m.alias.trim()
  return `${m.aggregation}_${m.field.replace(/[^a-zA-Z0-9_]/g, '_')}`
}

function defaultDefinition(type: ReportType): Definition {
  switch (type) {
    case 'flat_list':
      return { type, fields: [], filters: [], sort: [] }
    case 'grouped':
      return { type, fields: [], groupBy: [], measures: [], filters: [], sort: [] }
    case 'pivot':
      return { type, rows: [], cols: [], value: null, filters: [] }
    case 'chart':
      return {
        type,
        chart: { type: 'bar', xField: '', yFields: [] },
        filters: [],
        groupBy: [],
        measures: [],
      }
    case 'summary':
      return { type, measures: [], filters: [] }
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function parseDefinition(raw: unknown, fallbackType: ReportType): Definition {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const rawType = typeof obj.type === 'string' ? obj.type : fallbackType
  const type = (['flat_list', 'grouped', 'pivot', 'chart', 'summary'].includes(rawType)
    ? rawType
    : fallbackType) as ReportType
  if (type === 'flat_list') {
    return {
      type,
      fields: asArray<string>(obj.fields).filter((f) => typeof f === 'string' && f.length > 0),
      filters: asArray<FilterShape>(obj.filters),
      sort: asArray<SortShape>(obj.sort).filter((s) => s && typeof s.field === 'string'),
      limit: typeof obj.limit === 'number' && obj.limit > 0 ? obj.limit : undefined,
    }
  }
  if (type === 'grouped') {
    return {
      type,
      fields: asArray<string>(obj.fields).filter((f) => typeof f === 'string' && f.length > 0),
      groupBy: asArray<string>(obj.groupBy).filter((f) => typeof f === 'string' && f.length > 0),
      measures: asArray<MeasureExpr>(obj.measures).filter((m) => m && typeof m.field === 'string'),
      filters: asArray<FilterShape>(obj.filters),
      sort: asArray<SortShape>(obj.sort).filter((s) => s && typeof s.field === 'string'),
      limit: typeof obj.limit === 'number' && obj.limit > 0 ? obj.limit : undefined,
    }
  }
  if (type === 'pivot') {
    const rawValue = obj.value && typeof obj.value === 'object'
      ? (obj.value as MeasureExpr)
      : null
    return {
      type,
      rows: asArray<string>(obj.rows).filter((f) => typeof f === 'string' && f.length > 0),
      cols: asArray<string>(obj.cols).filter((f) => typeof f === 'string' && f.length > 0),
      value: rawValue && typeof rawValue.field === 'string' ? rawValue : null,
      filters: asArray<FilterShape>(obj.filters),
    }
  }
  if (type === 'chart') {
    const rawChart = obj.chart && typeof obj.chart === 'object'
      ? (obj.chart as Partial<ChartSpec>)
      : {}
    const chartType = CHART_TYPES.includes(rawChart.type as ChartType) ? rawChart.type as ChartType : 'bar'
    return {
      type,
      chart: {
        type: chartType,
        xField: typeof rawChart.xField === 'string' ? rawChart.xField : '',
        yFields: asArray<string>(rawChart.yFields).filter((f) => typeof f === 'string'),
        stacked: typeof rawChart.stacked === 'boolean' ? rawChart.stacked : undefined,
        showLegend: typeof rawChart.showLegend === 'boolean' ? rawChart.showLegend : undefined,
      },
      filters: asArray<FilterShape>(obj.filters),
      groupBy: asArray<string>(obj.groupBy).filter((f) => typeof f === 'string'),
      measures: asArray<MeasureExpr>(obj.measures).filter((m) => m && typeof m.field === 'string'),
      limit: typeof obj.limit === 'number' && obj.limit > 0 ? obj.limit : undefined,
    }
  }
  return {
    type: 'summary',
    measures: asArray<MeasureExpr>(obj.measures).filter((m) => m && typeof m.field === 'string'),
    filters: asArray<FilterShape>(obj.filters),
  }
}

function migrateDefinition(prev: Definition, nextType: ReportType): Definition {
  if (prev.type === nextType) return prev
  const base = defaultDefinition(nextType)
  // Best-effort field migration so the user does not lose their work.
  if ((base.type === 'grouped' || base.type === 'flat_list') && (prev.type === 'flat_list' || prev.type === 'grouped')) {
    const fields = 'fields' in prev ? prev.fields : []
    if (base.type === 'flat_list') return { ...base, fields: [...fields] }
    return { ...base, fields: [...fields] }
  }
  return base
}

export default function ReportBuilderPage() {
  const params = useParams() as { id?: string }
  const router = useRouter()
  const t = useT()
  const tRef = React.useRef(t)
  React.useEffect(() => { tRef.current = t }, [t])
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const reportId = params?.id ? String(params.id) : ''

  const [report, setReport] = React.useState<ReportDetail | null>(null)
  const [dataset, setDataset] = React.useState<DatasetDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [definition, setDefinition] = React.useState<Definition>(defaultDefinition('flat_list'))
  const [isSaving, setIsSaving] = React.useState(false)
  const [isRunning, setIsRunning] = React.useState(false)
  const [isDirty, setIsDirty] = React.useState(false)
  const [runResult, setRunResult] = React.useState<ReportRunResponse | null>(null)

  // Single load effect. Depends ONLY on reportId — translation is accessed
  // via tRef so locale flicker cannot retrigger the load (previously caused
  // an endless spinner when t was not perfectly stable).
  React.useEffect(() => {
    if (!reportId) return
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const search = new URLSearchParams({ id: reportId, pageSize: '1' })
        const reportCall = await apiCall<{ items?: ReportDetail[] }>(
          `/api/reports/reports?${search.toString()}`,
          undefined,
          { fallback: { items: [] } },
        )
        if (cancelled) return
        if (!reportCall.ok) {
          setLoadError(tRef.current('reports.detail.error.load', 'Failed to load report.'))
          return
        }
        const items = Array.isArray(reportCall.result?.items) ? reportCall.result!.items! : []
        const found = items[0]
        if (!found) {
          setLoadError(tRef.current('reports.detail.error.notFound', 'Report not found or not visible.'))
          return
        }
        setReport(found)
        setName(found.name)
        setDescription(found.description ?? '')
        setDefinition(parseDefinition(found.definition, found.type))

        const datasetCall = await apiCall<DatasetDetail>(
          `/api/reports/datasets/${encodeURIComponent(found.datasetId)}`,
        )
        if (cancelled) return
        if (datasetCall.ok && datasetCall.result) {
          setDataset(datasetCall.result)
        } else {
          setLoadError(tRef.current('reports.detail.error.datasetLoad', 'Failed to load dataset.'))
        }
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error
          ? err.message
          : tRef.current('reports.detail.error.load', 'Failed to load report.')
        setLoadError(message)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [reportId])

  const datasetFields = dataset?.fields ?? []
  const canEdit = report?.permission === 'edit'

  const markDirty = React.useCallback(() => setIsDirty(true), [])

  const handleTypeChange = React.useCallback((next: ReportType) => {
    if (!canEdit) return
    setDefinition((prev) => migrateDefinition(prev, next))
    markDirty()
  }, [canEdit, markDirty])

  const handleSave = React.useCallback(async () => {
    if (!report || !canEdit) return
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
      setReport((prev) => prev
        ? {
            ...prev,
            name: name.trim() || prev.name,
            description: description.trim() || null,
            type: definition.type,
            definition,
            version: prev.version + 1,
          }
        : prev)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('reports.detail.error.save', 'Failed to save report.')
      flash(message, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [canEdit, definition, description, name, report, t])

  const handleRun = React.useCallback(async () => {
    if (!report) return
    if (definition.type !== 'flat_list') {
      flash(t('reports.detail.run.flatListOnly', 'Run preview currently supports flat_list only — aggregated types ship in Phase 3.5+.'), 'warning')
      return
    }
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
  }, [confirm, definition.type, isDirty, report, t])

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

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-4">
          <BuilderHeader
            report={report}
            canEdit={canEdit}
            isSaving={isSaving}
            isRunning={isRunning}
            isDirty={isDirty}
            onRun={handleRun}
            onSave={handleSave}
            onDelete={handleDelete}
            t={t}
          />

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-4 lg:col-span-1">
              <MetadataCard
                name={name}
                description={description}
                datasetId={report.datasetId}
                canEdit={canEdit}
                isSaving={isSaving}
                onNameChange={(value) => { setName(value); markDirty() }}
                onDescriptionChange={(value) => { setDescription(value); markDirty() }}
                t={t}
              />
              <FieldList fields={datasetFields} hiddenPaths={dataset?.hiddenFieldPaths ?? []} t={t} />
            </div>

            <div className="flex flex-col gap-4 lg:col-span-2">
              <TypeSwitcher
                value={definition.type}
                onChange={handleTypeChange}
                canEdit={canEdit}
                t={t}
              />
              <PerTypeCanvas
                definition={definition}
                fields={datasetFields}
                canEdit={canEdit}
                onChange={(next) => { setDefinition(next); markDirty() }}
                t={t}
              />
            </div>
          </div>

          <PreviewSection
            definition={definition}
            runResult={runResult}
            isRunning={isRunning}
            t={t}
          />
        </div>
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}

// ---------- Header ----------

type BuilderHeaderProps = {
  report: ReportDetail
  canEdit: boolean
  isSaving: boolean
  isRunning: boolean
  isDirty: boolean
  onRun: () => void
  onSave: () => void
  onDelete: () => void
  t: ReturnType<typeof useT>
}

function BuilderHeader({
  report,
  canEdit,
  isSaving,
  isRunning,
  isDirty,
  onRun,
  onSave,
  onDelete,
  t,
}: BuilderHeaderProps) {
  return (
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
        <Button type="button" variant="outline" onClick={onRun} disabled={isRunning}>
          <Play className="size-4" aria-hidden />
          <span>{isRunning ? t('reports.detail.actions.running', 'Running…') : t('reports.detail.actions.run', 'Run')}</span>
        </Button>
        {canEdit ? (
          <Button type="button" onClick={onSave} disabled={isSaving || !isDirty}>
            <Save className="size-4" aria-hidden />
            <span>{isSaving ? t('reports.detail.actions.saving', 'Saving…') : t('reports.detail.actions.save', 'Save')}</span>
          </Button>
        ) : null}
        {canEdit ? (
          <Button type="button" variant="destructive" onClick={onDelete}>
            <Trash2 className="size-4" aria-hidden />
            <span>{t('reports.detail.actions.delete', 'Delete')}</span>
          </Button>
        ) : null}
      </div>
    </div>
  )
}

// ---------- Metadata ----------

type MetadataCardProps = {
  name: string
  description: string
  datasetId: string
  canEdit: boolean
  isSaving: boolean
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  t: ReturnType<typeof useT>
}

function MetadataCard({
  name,
  description,
  datasetId,
  canEdit,
  isSaving,
  onNameChange,
  onDescriptionChange,
  t,
}: MetadataCardProps) {
  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-4">
      <h2 className="text-overline text-muted-foreground">{t('reports.detail.sections.metadata', 'Metadata')}</h2>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.fields.name', 'Name')}</span>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          disabled={!canEdit || isSaving}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.fields.description', 'Description')}</span>
        <Textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          disabled={!canEdit || isSaving}
          rows={3}
        />
      </label>
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.fields.dataset', 'Dataset')}</span>
        <p className="font-mono text-sm">{datasetId}</p>
      </div>
    </section>
  )
}

// ---------- Field list ----------

type FieldListProps = {
  fields: DatasetFieldRow[]
  hiddenPaths: string[]
  t: ReturnType<typeof useT>
}

function FieldList({ fields, hiddenPaths, t }: FieldListProps) {
  return (
    <section className="space-y-2 rounded-md border border-border bg-card p-4">
      <h2 className="text-overline text-muted-foreground">{t('reports.detail.sections.fields', 'Dataset fields')}</h2>
      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('reports.detail.fields.empty', 'No fields available for this dataset.')}</p>
      ) : (
        <ul className="space-y-1 max-h-96 overflow-y-auto">
          {fields.map((field) => (
            <li
              key={field.key}
              className="rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{t(field.labelKey, field.key)}</span>
                <span className="text-xs text-muted-foreground">{field.kind}</span>
              </div>
              <div className="mt-1 font-mono text-xs text-muted-foreground">{field.key}</div>
            </li>
          ))}
        </ul>
      )}
      {hiddenPaths.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('reports.detail.fields.hiddenCount', '{count} hidden by ACL').replace('{count}', String(hiddenPaths.length))}
        </p>
      ) : null}
    </section>
  )
}

// ---------- Type switcher ----------

type TypeSwitcherProps = {
  value: ReportType
  onChange: (next: ReportType) => void
  canEdit: boolean
  t: ReturnType<typeof useT>
}

const TYPE_OPTIONS: ReadonlyArray<ReportType> = ['flat_list', 'grouped', 'pivot', 'chart', 'summary']

function TypeSwitcher({ value, onChange, canEdit, t }: TypeSwitcherProps) {
  return (
    <section className="space-y-2 rounded-md border border-border bg-card p-4">
      <h2 className="text-overline text-muted-foreground">{t('reports.detail.sections.type', 'Report type')}</h2>
      <div className="flex flex-wrap gap-2">
        {TYPE_OPTIONS.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={value === option ? 'default' : 'outline'}
            onClick={() => onChange(option)}
            disabled={!canEdit}
            aria-pressed={value === option}
          >
            {t(`reports.list.types.${option}`, option)}
          </Button>
        ))}
      </div>
    </section>
  )
}

// ---------- Per-type canvas ----------

type CanvasProps = {
  definition: Definition
  fields: DatasetFieldRow[]
  canEdit: boolean
  onChange: (next: Definition) => void
  t: ReturnType<typeof useT>
}

function PerTypeCanvas({ definition, fields, canEdit, onChange, t }: CanvasProps) {
  const fieldByKey = React.useMemo(() => {
    const map = new Map<string, DatasetFieldRow>()
    for (const f of fields) map.set(f.key, f)
    return map
  }, [fields])

  switch (definition.type) {
    case 'flat_list':
      return (
        <FlatListCanvas
          definition={definition}
          fields={fields}
          canEdit={canEdit}
          onChange={onChange}
          t={t}
        />
      )
    case 'grouped':
      return (
        <GroupedCanvas
          definition={definition}
          fields={fields}
          fieldByKey={fieldByKey}
          canEdit={canEdit}
          onChange={onChange}
          t={t}
        />
      )
    case 'pivot':
      return (
        <PivotCanvas
          definition={definition}
          fields={fields}
          fieldByKey={fieldByKey}
          canEdit={canEdit}
          onChange={onChange}
          t={t}
        />
      )
    case 'chart':
      return (
        <ChartCanvas
          definition={definition}
          fields={fields}
          fieldByKey={fieldByKey}
          canEdit={canEdit}
          onChange={onChange}
          t={t}
        />
      )
    case 'summary':
      return (
        <SummaryCanvas
          definition={definition}
          fields={fields}
          fieldByKey={fieldByKey}
          canEdit={canEdit}
          onChange={onChange}
          t={t}
        />
      )
  }
}

// ---------- Common zone primitives ----------

type ZoneProps = {
  title: string
  description?: string
  children: React.ReactNode
  emptyLabel?: string
  isEmpty?: boolean
}

function Zone({ title, description, children, emptyLabel, isEmpty }: ZoneProps) {
  return (
    <section className="space-y-2 rounded-md border border-dashed border-border bg-card/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      <div className="min-h-[2rem] space-y-1">
        {isEmpty && emptyLabel ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">{emptyLabel}</p>
        ) : (
          children
        )}
      </div>
    </section>
  )
}

type FieldPickerProps = {
  fields: DatasetFieldRow[]
  selected: ReadonlySet<string>
  disabled?: boolean
  buttonLabel: string
  onPick: (fieldKey: string) => void
  t: ReturnType<typeof useT>
}

function FieldPicker({ fields, selected, disabled, buttonLabel, onPick, t }: FieldPickerProps) {
  const [open, setOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!open) return
    function onDocClick(event: MouseEvent) {
      const node = containerRef.current
      if (node && event.target instanceof Node && !node.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const available = fields.filter((f) => !selected.has(f.key))

  return (
    <div className="relative inline-block" ref={containerRef}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || available.length === 0}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Plus className="size-3.5" aria-hidden />
        <span>{buttonLabel}</span>
      </Button>
      {open ? (
        <div className="absolute z-10 mt-1 max-h-64 w-72 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
          {available.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {t('reports.detail.picker.empty', 'No more fields available.')}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {available.map((field) => (
                <li key={field.key}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1 text-left text-sm hover:bg-muted"
                    onClick={() => { onPick(field.key); setOpen(false) }}
                  >
                    <span className="font-medium">{t(field.labelKey, field.key)}</span>
                    <span className="font-mono text-xs text-muted-foreground">{field.key} · {field.kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}

type ChipProps = {
  label: string
  sublabel?: string
  onRemove?: () => void
  disabled?: boolean
  children?: React.ReactNode
}

function Chip({ label, sublabel, onRemove, disabled, children }: ChipProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-sm">
      <div className="flex flex-col">
        <span className="font-medium">{label}</span>
        {sublabel ? <span className="font-mono text-xs text-muted-foreground">{sublabel}</span> : null}
      </div>
      {children ? <div className="ml-auto">{children}</div> : null}
      {onRemove ? (
        <button
          type="button"
          className={cn('ml-1 rounded-sm p-0.5 hover:bg-muted', disabled ? 'opacity-50' : '')}
          onClick={() => { if (!disabled) onRemove() }}
          disabled={disabled}
          aria-label="Remove"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

// ---------- Per-type canvases ----------

type FlatListCanvasProps = {
  definition: FlatListDef
  fields: DatasetFieldRow[]
  canEdit: boolean
  onChange: (next: Definition) => void
  t: ReturnType<typeof useT>
}

function FlatListCanvas({ definition, fields, canEdit, onChange, t }: FlatListCanvasProps) {
  const fieldByKey = React.useMemo(() => {
    const map = new Map<string, DatasetFieldRow>()
    for (const f of fields) map.set(f.key, f)
    return map
  }, [fields])
  const selectedFields = React.useMemo(() => new Set(definition.fields), [definition.fields])
  const sortableFields = React.useMemo(() => fields.filter((f) => f.sortable !== false), [fields])

  const setFields = (next: string[]) => onChange({ ...definition, fields: next })
  const setSort = (next: SortShape[]) => onChange({ ...definition, sort: next })
  const setLimit = (next?: number) => onChange({ ...definition, limit: next })

  const sortField = definition.sort[0]?.field ?? ''
  const sortDir = (definition.sort[0]?.dir ?? 'asc') as 'asc' | 'desc'

  return (
    <div className="space-y-3">
      <Zone
        title={t('reports.detail.zones.fields', 'Fields')}
        description={t('reports.detail.zones.fieldsHint', 'Columns to project from the dataset.')}
        isEmpty={definition.fields.length === 0}
        emptyLabel={t('reports.detail.zones.empty', 'Empty — add at least one field.')}
      >
        <div className="flex flex-wrap items-center gap-2">
          {definition.fields.map((fieldKey) => {
            const field = fieldByKey.get(fieldKey)
            return (
              <Chip
                key={fieldKey}
                label={field ? t(field.labelKey, field.key) : fieldKey}
                sublabel={fieldKey}
                disabled={!canEdit}
                onRemove={() => setFields(definition.fields.filter((f) => f !== fieldKey))}
              />
            )
          })}
          <FieldPicker
            fields={fields}
            selected={selectedFields}
            disabled={!canEdit}
            buttonLabel={t('reports.detail.actions.addField', 'Add field')}
            onPick={(k) => setFields([...definition.fields, k])}
            t={t}
          />
        </div>
      </Zone>

      <Zone
        title={t('reports.detail.zones.sort', 'Sort')}
        description={t('reports.detail.zones.sortHint', 'First sort key wins; deeper keys ship in 3.3b.')}
      >
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sortField}
            onChange={(e) => {
              const value = e.target.value
              if (!value) return setSort([])
              setSort([{ field: value, dir: sortDir }])
            }}
            disabled={!canEdit}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">{t('reports.detail.fields.sortNone', 'No sort')}</option>
            {sortableFields.map((f) => (
              <option key={f.key} value={f.key}>{t(f.labelKey, f.key)}</option>
            ))}
          </select>
          <select
            value={sortDir}
            onChange={(e) => {
              if (!sortField) return
              setSort([{ field: sortField, dir: e.target.value as 'asc' | 'desc' }])
            }}
            disabled={!canEdit || !sortField}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="asc">{t('reports.detail.fields.sortAsc', 'Ascending')}</option>
            <option value="desc">{t('reports.detail.fields.sortDesc', 'Descending')}</option>
          </select>
        </div>
      </Zone>

      <Zone
        title={t('reports.detail.zones.limit', 'Limit')}
        description={t('reports.detail.zones.limitHint', 'Optional row cap (max 100 000).')}
      >
        <Input
          type="number"
          min={1}
          max={100000}
          value={definition.limit ?? ''}
          onChange={(e) => {
            const raw = e.target.value
            if (!raw.trim()) return setLimit(undefined)
            const parsed = Number(raw)
            if (!Number.isFinite(parsed) || parsed <= 0) return
            setLimit(Math.min(Math.floor(parsed), 100_000))
          }}
          disabled={!canEdit}
          placeholder={t('reports.detail.fields.limitPlaceholder', 'No limit')}
          className="max-w-xs"
        />
      </Zone>
    </div>
  )
}

type GroupedCanvasProps = {
  definition: GroupedDef
  fields: DatasetFieldRow[]
  fieldByKey: Map<string, DatasetFieldRow>
  canEdit: boolean
  onChange: (next: Definition) => void
  t: ReturnType<typeof useT>
}

function GroupedCanvas({ definition, fields, fieldByKey, canEdit, onChange, t }: GroupedCanvasProps) {
  const categoricalFields = React.useMemo(() => fields.filter(isFieldCategorical), [fields])
  const groupedSet = React.useMemo(() => new Set(definition.groupBy), [definition.groupBy])

  const setGroupBy = (next: string[]) => onChange({ ...definition, groupBy: next })
  const setMeasures = (next: MeasureExpr[]) => onChange({ ...definition, measures: next })

  return (
    <div className="space-y-3">
      <Zone
        title={t('reports.detail.zones.groupBy', 'Group by')}
        description={t('reports.detail.zones.groupByHint', 'Categorical fields that define one row per distinct combination.')}
        isEmpty={definition.groupBy.length === 0}
        emptyLabel={t('reports.detail.zones.empty', 'Empty — add at least one field.')}
      >
        <div className="flex flex-wrap items-center gap-2">
          {definition.groupBy.map((key) => {
            const field = fieldByKey.get(key)
            return (
              <Chip
                key={key}
                label={field ? t(field.labelKey, field.key) : key}
                sublabel={key}
                disabled={!canEdit}
                onRemove={() => setGroupBy(definition.groupBy.filter((f) => f !== key))}
              />
            )
          })}
          <FieldPicker
            fields={categoricalFields}
            selected={groupedSet}
            disabled={!canEdit}
            buttonLabel={t('reports.detail.actions.addField', 'Add field')}
            onPick={(k) => setGroupBy([...definition.groupBy, k])}
            t={t}
          />
        </div>
      </Zone>

      <MeasureZone
        measures={definition.measures}
        fields={fields}
        fieldByKey={fieldByKey}
        canEdit={canEdit}
        onChange={setMeasures}
        t={t}
        title={t('reports.detail.zones.measures', 'Measures')}
        description={t('reports.detail.zones.measuresHint', 'Aggregated values per group. Numeric measures support sum/avg/min/max; any field supports count/count_distinct.')}
      />
    </div>
  )
}

type MeasureZoneProps = {
  measures: MeasureExpr[]
  fields: DatasetFieldRow[]
  fieldByKey: Map<string, DatasetFieldRow>
  canEdit: boolean
  onChange: (next: MeasureExpr[]) => void
  t: ReturnType<typeof useT>
  title: string
  description?: string
  allowMultiple?: boolean
}

function MeasureZone({
  measures,
  fields,
  fieldByKey,
  canEdit,
  onChange,
  t,
  title,
  description,
  allowMultiple = true,
}: MeasureZoneProps) {
  const usedFieldsSet = React.useMemo(() => {
    if (allowMultiple) return new Set<string>()
    return new Set(measures.map((m) => m.field))
  }, [allowMultiple, measures])

  const addMeasure = (fieldKey: string) => {
    const field = fieldByKey.get(fieldKey)
    if (!field) return
    const allowed = fieldAllowedAggregations(field)
    const aggregation = allowed[0] ?? 'count'
    const next: MeasureExpr[] = allowMultiple
      ? [...measures, { field: fieldKey, aggregation }]
      : [{ field: fieldKey, aggregation }]
    onChange(next)
  }

  const updateMeasure = (idx: number, patch: Partial<MeasureExpr>) => {
    const next = measures.map((m, i) => (i === idx ? { ...m, ...patch } : m))
    onChange(next)
  }

  const removeMeasure = (idx: number) => {
    const next = measures.filter((_, i) => i !== idx)
    onChange(next)
  }

  return (
    <Zone
      title={title}
      description={description}
      isEmpty={measures.length === 0}
      emptyLabel={t('reports.detail.zones.empty', 'Empty — add at least one field.')}
    >
      <div className="flex flex-col gap-2">
        {measures.map((measure, idx) => {
          const field = fieldByKey.get(measure.field)
          const allowed = field ? fieldAllowedAggregations(field) : [...ALL_AGGREGATIONS]
          return (
            <div
              key={`${measure.field}-${idx}`}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-2 py-1"
            >
              <span className="text-xs font-medium uppercase text-muted-foreground">
                {t(`reports.detail.aggregation.${measure.aggregation}`, measure.aggregation)}
              </span>
              <span className="font-medium">
                {field ? t(field.labelKey, field.key) : measure.field}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{measure.field}</span>
              <select
                value={measure.aggregation}
                onChange={(e) => updateMeasure(idx, { aggregation: e.target.value as Aggregation })}
                disabled={!canEdit}
                className="ml-2 h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                {allowed.map((agg) => (
                  <option key={agg} value={agg}>{t(`reports.detail.aggregation.${agg}`, agg)}</option>
                ))}
              </select>
              <Input
                value={measure.alias ?? ''}
                onChange={(e) => updateMeasure(idx, { alias: e.target.value || undefined })}
                disabled={!canEdit}
                placeholder={measureAlias(measure)}
                className="h-8 w-40 text-xs"
              />
              <button
                type="button"
                className="ml-auto rounded-sm p-1 hover:bg-muted disabled:opacity-50"
                onClick={() => canEdit && removeMeasure(idx)}
                disabled={!canEdit}
                aria-label={t('reports.detail.actions.removeMeasure', 'Remove measure')}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          )
        })}
        <div>
          <FieldPicker
            fields={fields}
            selected={usedFieldsSet}
            disabled={!canEdit || (!allowMultiple && measures.length >= 1)}
            buttonLabel={t('reports.detail.actions.addMeasure', 'Add measure')}
            onPick={addMeasure}
            t={t}
          />
        </div>
      </div>
    </Zone>
  )
}

type PivotCanvasProps = {
  definition: PivotDef
  fields: DatasetFieldRow[]
  fieldByKey: Map<string, DatasetFieldRow>
  canEdit: boolean
  onChange: (next: Definition) => void
  t: ReturnType<typeof useT>
}

function PivotCanvas({ definition, fields, fieldByKey, canEdit, onChange, t }: PivotCanvasProps) {
  const categoricalFields = React.useMemo(() => fields.filter(isFieldCategorical), [fields])
  const rowsSet = React.useMemo(() => new Set(definition.rows), [definition.rows])
  const colsSet = React.useMemo(() => new Set(definition.cols), [definition.cols])
  const rowsExcludingCols = React.useMemo(
    () => categoricalFields.filter((f) => !colsSet.has(f.key)),
    [categoricalFields, colsSet],
  )
  const colsExcludingRows = React.useMemo(
    () => categoricalFields.filter((f) => !rowsSet.has(f.key)),
    [categoricalFields, rowsSet],
  )

  return (
    <div className="space-y-3">
      <Zone
        title={t('reports.detail.zones.pivotRows', 'Rows')}
        description={t('reports.detail.zones.pivotRowsHint', 'Field(s) on the row axis. Cannot overlap with cols.')}
        isEmpty={definition.rows.length === 0}
        emptyLabel={t('reports.detail.zones.empty', 'Empty — add at least one field.')}
      >
        <div className="flex flex-wrap items-center gap-2">
          {definition.rows.map((key) => {
            const field = fieldByKey.get(key)
            return (
              <Chip
                key={key}
                label={field ? t(field.labelKey, field.key) : key}
                sublabel={key}
                disabled={!canEdit}
                onRemove={() => onChange({ ...definition, rows: definition.rows.filter((f) => f !== key) })}
              />
            )
          })}
          <FieldPicker
            fields={rowsExcludingCols}
            selected={rowsSet}
            disabled={!canEdit}
            buttonLabel={t('reports.detail.actions.addRow', 'Add row')}
            onPick={(k) => onChange({ ...definition, rows: [...definition.rows, k] })}
            t={t}
          />
        </div>
      </Zone>

      <Zone
        title={t('reports.detail.zones.pivotCols', 'Columns')}
        description={t('reports.detail.zones.pivotColsHint', 'Field(s) on the column axis. Cannot overlap with rows.')}
        isEmpty={definition.cols.length === 0}
        emptyLabel={t('reports.detail.zones.empty', 'Empty — add at least one field.')}
      >
        <div className="flex flex-wrap items-center gap-2">
          {definition.cols.map((key) => {
            const field = fieldByKey.get(key)
            return (
              <Chip
                key={key}
                label={field ? t(field.labelKey, field.key) : key}
                sublabel={key}
                disabled={!canEdit}
                onRemove={() => onChange({ ...definition, cols: definition.cols.filter((f) => f !== key) })}
              />
            )
          })}
          <FieldPicker
            fields={colsExcludingRows}
            selected={colsSet}
            disabled={!canEdit}
            buttonLabel={t('reports.detail.actions.addColumn', 'Add column')}
            onPick={(k) => onChange({ ...definition, cols: [...definition.cols, k] })}
            t={t}
          />
        </div>
      </Zone>

      <MeasureZone
        measures={definition.value ? [definition.value] : []}
        fields={fields}
        fieldByKey={fieldByKey}
        canEdit={canEdit}
        onChange={(next) => onChange({ ...definition, value: next[0] ?? null })}
        t={t}
        title={t('reports.detail.zones.pivotValue', 'Value')}
        description={t('reports.detail.zones.pivotValueHint', 'Exactly one aggregated measure fills each cell.')}
        allowMultiple={false}
      />
    </div>
  )
}

type SummaryCanvasProps = {
  definition: SummaryDef
  fields: DatasetFieldRow[]
  fieldByKey: Map<string, DatasetFieldRow>
  canEdit: boolean
  onChange: (next: Definition) => void
  t: ReturnType<typeof useT>
}

function SummaryCanvas({ definition, fields, fieldByKey, canEdit, onChange, t }: SummaryCanvasProps) {
  return (
    <MeasureZone
      measures={definition.measures}
      fields={fields}
      fieldByKey={fieldByKey}
      canEdit={canEdit}
      onChange={(next) => onChange({ ...definition, measures: next })}
      t={t}
      title={t('reports.detail.zones.summaryMeasures', 'Summary measures')}
      description={t('reports.detail.zones.summaryMeasuresHint', 'One row of aggregated values across the whole dataset.')}
    />
  )
}

type ChartCanvasProps = {
  definition: ChartDef
  fields: DatasetFieldRow[]
  fieldByKey: Map<string, DatasetFieldRow>
  canEdit: boolean
  onChange: (next: Definition) => void
  t: ReturnType<typeof useT>
}

function ChartCanvas({ definition, fields, fieldByKey, canEdit, onChange, t }: ChartCanvasProps) {
  const categoricalFields = React.useMemo(() => fields.filter(isFieldCategorical), [fields])
  const groupBySet = React.useMemo(() => new Set(definition.groupBy), [definition.groupBy])
  const measureAliases = React.useMemo(
    () => definition.measures.map((m) => measureAlias(m)),
    [definition.measures],
  )
  const xCandidates = definition.groupBy.length > 0
    ? categoricalFields.filter((f) => groupBySet.has(f.key))
    : categoricalFields
  const yCandidatesAliases = measureAliases
  const yFieldsSet = React.useMemo(() => new Set(definition.chart.yFields), [definition.chart.yFields])

  const updateChart = (patch: Partial<ChartSpec>) => onChange({
    ...definition,
    chart: { ...definition.chart, ...patch },
  })

  return (
    <div className="space-y-3">
      <Zone
        title={t('reports.detail.zones.chartSpec', 'Chart')}
        description={t('reports.detail.zones.chartSpecHint', 'Pick the chart type and the dimensions to plot.')}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.chart.type', 'Chart type')}</span>
            <select
              value={definition.chart.type}
              onChange={(e) => updateChart({ type: e.target.value as ChartType })}
              disabled={!canEdit}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {CHART_TYPES.map((kind) => (
                <option key={kind} value={kind}>{t(`reports.detail.chart.kind.${kind}`, kind)}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.chart.xField', 'X axis')}</span>
            <select
              value={definition.chart.xField}
              onChange={(e) => updateChart({ xField: e.target.value })}
              disabled={!canEdit}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">{t('reports.detail.chart.xFieldNone', '— pick a field —')}</option>
              {xCandidates.map((f) => (
                <option key={f.key} value={f.key}>{t(f.labelKey, f.key)} ({f.key})</option>
              ))}
            </select>
          </label>
        </div>
        <div className="space-y-1 pt-2">
          <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.chart.yFields', 'Y series')}</span>
          {yCandidatesAliases.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('reports.detail.chart.yFieldsEmpty', 'Add at least one measure below; the chart will plot its alias.')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {yCandidatesAliases.map((alias) => {
                const selected = yFieldsSet.has(alias)
                return (
                  <Button
                    key={alias}
                    type="button"
                    size="sm"
                    variant={selected ? 'default' : 'outline'}
                    onClick={() => updateChart({
                      yFields: selected
                        ? definition.chart.yFields.filter((y) => y !== alias)
                        : [...definition.chart.yFields, alias],
                    })}
                    disabled={!canEdit}
                  >
                    {alias}
                  </Button>
                )
              })}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(definition.chart.stacked)}
              onChange={(e) => updateChart({ stacked: e.target.checked })}
              disabled={!canEdit}
            />
            {t('reports.detail.chart.stacked', 'Stacked')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={definition.chart.showLegend !== false}
              onChange={(e) => updateChart({ showLegend: e.target.checked })}
              disabled={!canEdit}
            />
            {t('reports.detail.chart.showLegend', 'Show legend')}
          </label>
        </div>
      </Zone>

      <Zone
        title={t('reports.detail.zones.groupBy', 'Group by')}
        description={t('reports.detail.zones.chartGroupByHint', 'Optional: explicit groupBy for the underlying execution. Defaults to the X field.')}
      >
        <div className="flex flex-wrap items-center gap-2">
          {definition.groupBy.map((key) => {
            const field = fieldByKey.get(key)
            return (
              <Chip
                key={key}
                label={field ? t(field.labelKey, field.key) : key}
                sublabel={key}
                disabled={!canEdit}
                onRemove={() => onChange({ ...definition, groupBy: definition.groupBy.filter((f) => f !== key) })}
              />
            )
          })}
          <FieldPicker
            fields={categoricalFields}
            selected={groupBySet}
            disabled={!canEdit}
            buttonLabel={t('reports.detail.actions.addField', 'Add field')}
            onPick={(k) => onChange({ ...definition, groupBy: [...definition.groupBy, k] })}
            t={t}
          />
        </div>
      </Zone>

      <MeasureZone
        measures={definition.measures}
        fields={fields}
        fieldByKey={fieldByKey}
        canEdit={canEdit}
        onChange={(next) => onChange({ ...definition, measures: next })}
        t={t}
        title={t('reports.detail.zones.measures', 'Measures')}
        description={t('reports.detail.zones.chartMeasuresHint', 'Each measure alias becomes a series; pick which ones to plot under Y series.')}
      />
    </div>
  )
}

// ---------- Preview ----------

type PreviewSectionProps = {
  definition: Definition
  runResult: ReportRunResponse | null
  isRunning: boolean
  t: ReturnType<typeof useT>
}

function PreviewSection({ definition, runResult, isRunning, t }: PreviewSectionProps) {
  const renderedRows = Array.isArray(runResult?.rows) ? runResult!.rows! : []
  const renderedColumns = runResult?.meta?.fields && runResult.meta.fields.length
    ? runResult.meta.fields
    : (renderedRows[0] ? Object.keys(renderedRows[0]) : [])

  if (definition.type !== 'flat_list') {
    return (
      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="text-overline text-muted-foreground">{t('reports.detail.sections.preview', 'Preview')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('reports.detail.preview.aggregatedComingSoon', 'Aggregated previews ship in the next step (Phase 3.5+). For now save your definition and use the API once the aggregator is wired into the run route.')}
        </p>
      </section>
    )
  }

  return (
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
              {renderedRows.map((row, idx) => (
                <tr key={idx} className="border-b border-border/60 last:border-b-0">
                  {renderedColumns.map((col) => {
                    const value = row[col]
                    let display: string
                    if (value == null) display = '—'
                    else if (typeof value === 'object') display = JSON.stringify(value)
                    else display = String(value)
                    return <td key={col} className="px-3 py-2 align-top">{display}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
