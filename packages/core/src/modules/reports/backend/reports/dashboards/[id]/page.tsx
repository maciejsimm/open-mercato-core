"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import type { ParameterDef, ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import { ArrowLeft, Eye, Pencil, Plus, RefreshCw, Save, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { readParameterDefs } from '../../../../lib/embed-spots'
import { ReportResultView, readRunMeta } from '../../../../widgets/injection/record-embed-host/ReportResultView'
import { ParameterValueInput, parameterLabel } from '../../../../widgets/injection/record-embed-host/ParameterValueInput'
import { DashboardGrid } from './DashboardGrid'
import { TileBindingsDialog, type TileBinding, type TileBindings } from './TileBindingsDialog'
import { DEFAULT_TILE_SIZE, findFreeSlot } from './grid'

type TileMode = 'inline' | 'summary' | 'chart-only'

type Tile = {
  id: string
  reportId: string
  x: number
  y: number
  w: number
  h: number
  mode: TileMode
  title?: string
  paramBindings?: TileBindings
}

type DashboardLayout = {
  grid: { cols: number; rowHeight: number; gap: number }
  tiles: Tile[]
}

type DashboardDetail = {
  id: string
  name: string
  description: string | null
  folderId: string
  permission: 'view' | 'edit'
  layout: unknown
  parameters: unknown
  version: number
  lastExecutedAt: string | null
  updatedAt: string | null
}

type ReportOption = {
  id: string
  name: string
  type: string
  datasetId: string
  definition: ReportDefinition | null
  parameters: ParameterDef[]
}

type ReportListItem = {
  id: string
  name: string
  type: string
  datasetId: string
  definition?: ReportDefinition | null
  parameters?: unknown
}

type TileRunResult = {
  tileId: string
  reportId: string
  mode: string
  rows?: Record<string, unknown>[]
  total?: number
  meta?: unknown
  error?: { code?: string; message?: string }
}

type ViewMode = 'view' | 'edit'

const DEFAULT_GRID = { cols: 12, rowHeight: 80, gap: 8 }
const TILE_MODES: TileMode[] = ['inline', 'summary', 'chart-only']
const PARAM_RERUN_DEBOUNCE_MS = 400
const EMPTY_BINDINGS: TileBindings = {}

function parseBinding(raw: unknown): TileBinding | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (obj.source === 'literal') return { source: 'literal', value: obj.value }
  if (obj.source === 'parameter' && typeof obj.parameter === 'string') return { source: 'parameter', parameter: obj.parameter }
  if (obj.source === 'record-field' && typeof obj.recordField === 'string') return { source: 'record-field', recordField: obj.recordField }
  return null
}

function parseLayout(raw: unknown): DashboardLayout {
  if (!raw || typeof raw !== 'object') return { grid: { ...DEFAULT_GRID }, tiles: [] }
  const obj = raw as Record<string, unknown>
  const gridRaw = obj.grid && typeof obj.grid === 'object' ? (obj.grid as Record<string, unknown>) : {}
  const grid = {
    cols: typeof gridRaw.cols === 'number' ? gridRaw.cols : DEFAULT_GRID.cols,
    rowHeight: typeof gridRaw.rowHeight === 'number' ? gridRaw.rowHeight : DEFAULT_GRID.rowHeight,
    gap: typeof gridRaw.gap === 'number' ? gridRaw.gap : DEFAULT_GRID.gap,
  }
  const tiles: Tile[] = []
  for (const entry of Array.isArray(obj.tiles) ? obj.tiles : []) {
    if (!entry || typeof entry !== 'object') continue
    const ti = entry as Record<string, unknown>
    if (typeof ti.id !== 'string' || typeof ti.reportId !== 'string') continue
    const bindings: TileBindings = {}
    if (ti.paramBindings && typeof ti.paramBindings === 'object') {
      for (const [key, value] of Object.entries(ti.paramBindings as Record<string, unknown>)) {
        const binding = parseBinding(value)
        if (binding) bindings[key] = binding
      }
    }
    tiles.push({
      id: ti.id,
      reportId: ti.reportId,
      x: typeof ti.x === 'number' ? ti.x : 0,
      y: typeof ti.y === 'number' ? ti.y : 0,
      w: typeof ti.w === 'number' && ti.w > 0 ? ti.w : 6,
      h: typeof ti.h === 'number' && ti.h > 0 ? ti.h : 4,
      mode: TILE_MODES.includes(ti.mode as TileMode) ? (ti.mode as TileMode) : 'inline',
      title: typeof ti.title === 'string' ? ti.title : undefined,
      paramBindings: Object.keys(bindings).length > 0 ? bindings : undefined,
    })
  }
  return { grid, tiles }
}

function nextTileId(layout: DashboardLayout): string {
  let counter = 1
  const used = new Set(layout.tiles.map((tile) => tile.id))
  while (used.has(`tile_${counter}`)) counter += 1
  return `tile_${counter}`
}

function initialParamValues(params: readonly ParameterDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const param of params) {
    if (param.defaultValue !== undefined) out[param.key] = param.defaultValue
  }
  return out
}

export default function DashboardPage({ params }: { params?: { id?: string } }) {
  const router = useRouter()
  const t = useT()
  const tRef = React.useRef(t)
  React.useEffect(() => { tRef.current = t }, [t])
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({ contextId: 'reports.dashboard.composer' })

  const dashboardId = params?.id ?? ''

  const [dashboard, setDashboard] = React.useState<DashboardDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [viewMode, setViewMode] = React.useState<ViewMode>('view')

  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [layout, setLayout] = React.useState<DashboardLayout>({ grid: { ...DEFAULT_GRID }, tiles: [] })
  const [dashboardParams, setDashboardParams] = React.useState<ParameterDef[]>([])
  const [paramValues, setParamValues] = React.useState<Record<string, unknown>>({})
  const [isSaving, setIsSaving] = React.useState(false)
  const [isDirty, setIsDirty] = React.useState(false)
  const [isRunning, setIsRunning] = React.useState(false)
  const [runResults, setRunResults] = React.useState<Map<string, TileRunResult>>(new Map())
  const [runToken, setRunToken] = React.useState(0)
  const [availableReports, setAvailableReports] = React.useState<ReportOption[]>([])
  const [librarySearch, setLibrarySearch] = React.useState('')
  const [bindingsTileId, setBindingsTileId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!dashboardId) return
    let active = true
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const search = new URLSearchParams({ id: dashboardId, pageSize: '1' })
        const [call, reportsCall] = await Promise.all([
          apiCall<{ items?: DashboardDetail[] }>(`/api/reports/dashboards?${search.toString()}`, undefined, { fallback: { items: [] } }),
          apiCall<{ items?: ReportListItem[] }>('/api/reports/reports?pageSize=100', undefined, { fallback: { items: [] } }),
        ])
        if (!active) return
        if (!call.ok) {
          setLoadError(tRef.current('reports.dashboards.detail.error.load', 'Failed to load dashboard.'))
          return
        }
        const found = Array.isArray(call.result?.items) ? call.result!.items![0] : undefined
        if (!found) {
          setLoadError(tRef.current('reports.dashboards.detail.error.notFound', 'Dashboard not found or not visible.'))
          return
        }
        const storedParams = readParameterDefs(found.parameters)
        setDashboard(found)
        setName(found.name)
        setDescription(found.description ?? '')
        setLayout(parseLayout(found.layout))
        setDashboardParams(storedParams)
        setParamValues(initialParamValues(storedParams))
        if (reportsCall.ok && Array.isArray(reportsCall.result?.items)) {
          setAvailableReports(reportsCall.result!.items!.map((report) => ({
            id: report.id,
            name: report.name,
            type: report.type,
            datasetId: report.datasetId,
            definition: report.definition ?? null,
            parameters: readParameterDefs(report.parameters),
          })))
        }
      } catch (err) {
        if (active) setLoadError(err instanceof Error ? err.message : tRef.current('reports.dashboards.detail.error.load', 'Failed to load dashboard.'))
      } finally {
        if (active) setIsLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [dashboardId])

  const canEdit = dashboard?.permission === 'edit'
  const editing = canEdit && viewMode === 'edit'
  const markDirty = React.useCallback(() => setIsDirty(true), [])
  const reportsById = React.useMemo(() => new Map(availableReports.map((report) => [report.id, report])), [availableReports])

  const runParams = React.useMemo(() => {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(paramValues)) {
      if (value !== undefined && value !== '') out[key] = value
    }
    return out
  }, [paramValues])
  const runParamsKey = JSON.stringify(runParams)

  React.useEffect(() => {
    if (!dashboard) return
    let cancelled = false
    const handle = window.setTimeout(async () => {
      setIsRunning(true)
      try {
        const result = await readApiResultOrThrow<{ tiles?: TileRunResult[] }>(
          `/api/reports/dashboards/${encodeURIComponent(dashboard.id)}/run`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ params: JSON.parse(runParamsKey) as Record<string, unknown> }),
          },
        )
        if (cancelled) return
        const map = new Map<string, TileRunResult>()
        for (const tile of Array.isArray(result?.tiles) ? result!.tiles! : []) map.set(tile.tileId, tile)
        setRunResults(map)
      } catch (err) {
        if (cancelled) return
        flash(err instanceof Error ? err.message : tRef.current('reports.dashboards.detail.error.run', 'Failed to run dashboard.'), 'error')
      } finally {
        if (!cancelled) setIsRunning(false)
      }
    }, runToken === 0 ? 0 : PARAM_RERUN_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [dashboard?.id, runParamsKey, runToken])

  const rerun = React.useCallback(() => setRunToken((value) => value + 1), [])

  const updateParamValue = React.useCallback((key: string, value: unknown) => {
    setParamValues((prev) => ({ ...prev, [key]: value }))
    setRunToken((value) => (value === 0 ? 1 : value))
  }, [])

  const addTile = React.useCallback((report: ReportOption) => {
    setLayout((prev) => {
      const slot = findFreeSlot(prev.tiles, DEFAULT_TILE_SIZE, prev.grid.cols)
      const tile: Tile = { id: nextTileId(prev), reportId: report.id, ...slot, mode: 'inline', title: report.name }
      return { ...prev, tiles: [...prev.tiles, tile] }
    })
    markDirty()
  }, [markDirty])

  const updateTile = React.useCallback((id: string, patch: Partial<Tile>) => {
    setLayout((prev) => ({ ...prev, tiles: prev.tiles.map((tile) => (tile.id === id ? { ...tile, ...patch } : tile)) }))
    markDirty()
  }, [markDirty])

  const removeTile = React.useCallback((id: string) => {
    setLayout((prev) => ({ ...prev, tiles: prev.tiles.filter((tile) => tile.id !== id) }))
    markDirty()
  }, [markDirty])

  const handleLayoutChange = React.useCallback((tiles: Tile[]) => {
    setLayout((prev) => ({ ...prev, tiles }))
    markDirty()
  }, [markDirty])

  const parameterCandidates = React.useMemo(() => {
    const seen = new Map<string, ParameterDef>()
    for (const param of dashboardParams) seen.set(param.key, param)
    for (const tile of layout.tiles) {
      for (const param of reportsById.get(tile.reportId)?.parameters ?? []) {
        if (!seen.has(param.key)) seen.set(param.key, param)
      }
    }
    return Array.from(seen.values())
  }, [dashboardParams, layout.tiles, reportsById])

  const toggleDashboardParam = React.useCallback((param: ParameterDef, include: boolean) => {
    setDashboardParams((prev) => (include ? [...prev.filter((p) => p.key !== param.key), { ...param }] : prev.filter((p) => p.key !== param.key)))
    if (!include) setParamValues((prev) => { const next = { ...prev }; delete next[param.key]; return next })
    markDirty()
  }, [markDirty])

  const setDashboardParamDefault = React.useCallback((key: string, value: unknown) => {
    setDashboardParams((prev) => prev.map((param) => (param.key === key ? { ...param, defaultValue: value } : param)))
    markDirty()
  }, [markDirty])

  const handleSave = React.useCallback(async () => {
    if (!dashboard || !canEdit || isSaving) return
    setIsSaving(true)
    const payload = {
      id: dashboard.id,
      name: name.trim() || dashboard.name,
      description: description.trim() ? description.trim() : null,
      layout,
      parameters: dashboardParams,
      version: dashboard.version,
    }
    try {
      await runMutation({
        operation: () => apiCallOrThrow('/api/reports/dashboards', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        context: { formId: 'reports.dashboard.composer', resourceKind: 'reports.dashboard', resourceId: dashboard.id },
        mutationPayload: payload,
      })
      flash(t('reports.dashboards.detail.success.save', 'Dashboard saved.'), 'success')
      setIsDirty(false)
      setDashboard((prev) => prev ? { ...prev, name: payload.name, description: payload.description, layout, parameters: dashboardParams, version: prev.version + 1 } : prev)
      rerun()
    } catch (err) {
      flash(err instanceof Error ? err.message : t('reports.dashboards.detail.error.save', 'Failed to save dashboard.'), 'error')
    } finally {
      setIsSaving(false)
    }
  }, [canEdit, dashboard, dashboardParams, description, isSaving, layout, name, rerun, runMutation, t])

  const handleDelete = React.useCallback(async () => {
    if (!dashboard || !canEdit) return
    const confirmed = await confirm({
      title: t('reports.dashboards.detail.delete.confirm', 'Delete dashboard "{name}"?', { name: dashboard.name }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: () => apiCallOrThrow(`/api/reports/dashboards?id=${encodeURIComponent(dashboard.id)}`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
        }),
        context: { formId: 'reports.dashboard.composer', resourceKind: 'reports.dashboard', resourceId: dashboard.id },
        mutationPayload: { id: dashboard.id },
      })
      flash(t('reports.dashboards.detail.success.delete', 'Dashboard deleted.'), 'success')
      router.push('/backend/reports/dashboards')
    } catch (err) {
      flash(err instanceof Error ? err.message : t('reports.dashboards.detail.error.delete', 'Failed to delete dashboard.'), 'error')
    }
  }, [canEdit, confirm, dashboard, router, runMutation, t])

  const handleLeaveEdit = React.useCallback(async () => {
    if (isDirty) {
      const confirmed = await confirm({
        title: t('reports.dashboards.detail.edit.discardConfirm', 'Discard unsaved changes?'),
        variant: 'destructive',
      })
      if (!confirmed) return
      if (dashboard) {
        setName(dashboard.name)
        setDescription(dashboard.description ?? '')
        setLayout(parseLayout(dashboard.layout))
        setDashboardParams(readParameterDefs(dashboard.parameters))
      }
      setIsDirty(false)
    }
    setViewMode('view')
  }, [confirm, dashboard, isDirty, t])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('reports.dashboards.detail.loading', 'Loading dashboard…')} />
        </PageBody>
      </Page>
    )
  }

  if (loadError || !dashboard) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={loadError ?? t('reports.dashboards.detail.error.notFound', 'Dashboard not found.')}
            action={(
              <Button asChild variant="outline" size="sm">
                <Link href="/backend/reports/dashboards">
                  <ArrowLeft className="size-4" aria-hidden />
                  <span>{t('reports.dashboards.detail.actions.backToList', 'Back to dashboards')}</span>
                </Link>
              </Button>
            )}
          />
        </PageBody>
      </Page>
    )
  }

  const query = librarySearch.trim().toLowerCase()
  const libraryReports = query
    ? availableReports.filter((report) => report.name.toLowerCase().includes(query))
    : availableReports
  const bindingsTile = bindingsTileId ? layout.tiles.find((tile) => tile.id === bindingsTileId) : undefined

  const renderTile = (tile: Tile, handles: { moveHandle: React.ReactNode }) => {
    const report = reportsById.get(tile.reportId)
    const result = runResults.get(tile.id) ?? null
    const title = tile.title || report?.name || t('reports.dashboards.detail.tiles.untitled', 'Untitled tile')
    const overrideCount = Object.keys(tile.paramBindings ?? {}).length
    return (
      <article className="flex h-full flex-col overflow-hidden rounded-md border border-border bg-card">
        <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
          {handles.moveHandle}
          {editing ? (
            <Input
              value={tile.title ?? ''}
              onChange={(event) => updateTile(tile.id, { title: event.target.value || undefined })}
              placeholder={report?.name ?? tile.reportId}
              aria-label={t('reports.dashboards.detail.tiles.title', 'Tile title')}
              className="h-8 min-w-0 flex-1 text-sm"
            />
          ) : (
            <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</h3>
          )}
          {editing ? (
            <>
              <Select value={tile.mode} onValueChange={(value) => updateTile(tile.id, { mode: value as TileMode })}>
                <SelectTrigger className="h-8 w-32" aria-label={t('reports.dashboards.detail.tiles.modeLabel', 'Display')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TILE_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>{t(`reports.dashboards.detail.tiles.mode.${mode}`, mode)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <IconButton
                variant="ghost"
                size="sm"
                aria-label={t('reports.dashboards.detail.tiles.bindings', 'Tile parameters')}
                aria-pressed={overrideCount > 0}
                onClick={() => setBindingsTileId(tile.id)}
              >
                <SlidersHorizontal className="size-3.5" aria-hidden />
              </IconButton>
              <IconButton
                variant="ghost"
                size="sm"
                aria-label={t('reports.dashboards.detail.tiles.remove', 'Remove tile')}
                onClick={() => removeTile(tile.id)}
              >
                <X className="size-3.5" aria-hidden />
              </IconButton>
            </>
          ) : report ? (
            <Link
              href={`/backend/reports/${encodeURIComponent(tile.reportId)}`}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              {t('reports.dashboards.detail.tiles.openReport', 'Open report')}
            </Link>
          ) : null}
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          {isRunning && !result ? (
            <div className="flex h-full items-center justify-center py-6">
              <Spinner className="size-5" />
            </div>
          ) : result?.error ? (
            <div className="rounded-md border border-status-warning-border bg-status-warning-bg px-3 py-2 text-sm text-status-warning-text">
              {result.error.message ?? t('reports.dashboards.detail.tiles.error', 'Failed to render tile.')}
            </div>
          ) : result?.rows ? (
            <ReportResultView
              rows={result.rows}
              meta={readRunMeta(result.meta)}
              definition={report?.definition ?? null}
              preferTable={tile.mode === 'summary'}
              maxRows={tile.mode === 'summary' ? 10 : 25}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {editing
                ? t('reports.dashboards.detail.tiles.saveToRender', 'Save the dashboard to render this tile.')
                : t('reports.dashboards.detail.tiles.emptyRows', 'No rows.')}
            </p>
          )}
        </div>
      </article>
    )
  }

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button asChild variant="ghost" size="sm">
                <Link href="/backend/reports/dashboards">
                  <ArrowLeft className="size-4" aria-hidden />
                  <span>{t('reports.dashboards.detail.actions.backToList', 'Back to dashboards')}</span>
                </Link>
              </Button>
              <div>
                <h1 className="text-xl font-semibold text-foreground">{editing ? name || dashboard.name : dashboard.name}</h1>
                {!editing && dashboard.description ? (
                  <p className="text-sm text-muted-foreground">{dashboard.description}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t('reports.dashboards.detail.metaLine', '{count} tiles', { count: layout.tiles.length })}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={rerun} disabled={isRunning || layout.tiles.length === 0}>
                {isRunning ? <Spinner className="size-4" /> : <RefreshCw className="size-4" aria-hidden />}
                <span>{t('reports.dashboards.detail.actions.refresh', 'Refresh')}</span>
              </Button>
              {canEdit && !editing ? (
                <Button type="button" variant="outline" onClick={() => setViewMode('edit')}>
                  <Pencil className="size-4" aria-hidden />
                  <span>{t('reports.dashboards.detail.actions.edit', 'Edit')}</span>
                </Button>
              ) : null}
              {editing ? (
                <>
                  <Button type="button" variant="outline" onClick={() => void handleLeaveEdit()}>
                    <Eye className="size-4" aria-hidden />
                    <span>{t('reports.dashboards.detail.actions.view', 'View')}</span>
                  </Button>
                  <Button type="button" onClick={() => void handleSave()} disabled={isSaving || !isDirty}>
                    <Save className="size-4" aria-hidden />
                    <span>{isSaving ? t('reports.dashboards.detail.actions.saving', 'Saving…') : t('reports.dashboards.detail.actions.save', 'Save')}</span>
                  </Button>
                  <Button type="button" variant="destructive" onClick={() => void handleDelete()}>
                    <Trash2 className="size-4" aria-hidden />
                    <span>{t('reports.dashboards.detail.actions.delete', 'Delete')}</span>
                  </Button>
                </>
              ) : null}
            </div>
          </div>

          {dashboardParams.length > 0 ? (
            <section
              className="flex flex-wrap items-end gap-4 rounded-md border border-border bg-card px-4 py-3"
              aria-label={t('reports.dashboards.detail.parameters.bar', 'Dashboard parameters')}
            >
              {dashboardParams.map((param) => (
                <div key={param.key} className="flex min-w-48 flex-col gap-1">
                  <Label htmlFor={`dashboard-param-${param.key}`} className="text-xs text-muted-foreground">
                    {parameterLabel(param, t)}
                  </Label>
                  <ParameterValueInput
                    id={`dashboard-param-${param.key}`}
                    param={param}
                    value={paramValues[param.key]}
                    onChange={(value) => updateParamValue(param.key, value)}
                  />
                </div>
              ))}
            </section>
          ) : null}

          <div className={editing ? 'grid gap-4 lg:grid-cols-4' : ''}>
            {editing ? (
              <aside className="space-y-4 rounded-md border border-border bg-card p-4 lg:col-span-1">
                <section className="space-y-2">
                  <h2 className="text-overline text-muted-foreground">{t('reports.dashboards.detail.sections.metadata', 'Metadata')}</h2>
                  <div className="space-y-1">
                    <Label htmlFor="dashboard-name">{t('reports.dashboards.detail.fields.name', 'Name')}</Label>
                    <Input id="dashboard-name" value={name} onChange={(event) => { setName(event.target.value); markDirty() }} disabled={isSaving} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dashboard-description">{t('reports.dashboards.detail.fields.description', 'Description')}</Label>
                    <Textarea id="dashboard-description" value={description} onChange={(event) => { setDescription(event.target.value); markDirty() }} disabled={isSaving} rows={3} />
                  </div>
                </section>

                <section className="space-y-2">
                  <h2 className="text-overline text-muted-foreground">{t('reports.dashboards.detail.sections.parameters', 'Dashboard parameters')}</h2>
                  {parameterCandidates.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t('reports.dashboards.detail.parameters.none', 'Tile reports declare no parameters.')}
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {parameterCandidates.map((param) => {
                        const included = dashboardParams.find((p) => p.key === param.key)
                        return (
                          <li key={param.key} className="space-y-1">
                            <CheckboxField
                              label={parameterLabel(param, t)}
                              sublabel={param.key}
                              checked={Boolean(included)}
                              onCheckedChange={(checked) => toggleDashboardParam(param, checked === true)}
                            />
                            {included ? (
                              <ParameterValueInput
                                param={included}
                                value={included.defaultValue}
                                onChange={(value) => setDashboardParamDefault(param.key, value)}
                              />
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t('reports.dashboards.detail.parameters.hint', 'Selected parameters appear in the bar above and apply to every tile whose report declares them.')}
                  </p>
                </section>

                <section className="space-y-2">
                  <h2 className="text-overline text-muted-foreground">{t('reports.dashboards.detail.sections.addTile', 'Add tile')}</h2>
                  <Input
                    value={librarySearch}
                    onChange={(event) => setLibrarySearch(event.target.value)}
                    placeholder={t('reports.dashboards.detail.add.search', 'Search reports')}
                    aria-label={t('reports.dashboards.detail.add.search', 'Search reports')}
                  />
                  {libraryReports.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {availableReports.length === 0
                        ? t('reports.dashboards.detail.add.noReports', 'No reports available — create some first.')
                        : t('reports.dashboards.detail.add.noMatch', 'No reports match.')}
                    </p>
                  ) : (
                    <ul className="max-h-96 space-y-1 overflow-y-auto">
                      {libraryReports.map((report) => (
                        <li key={report.id}>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-auto w-full justify-between px-3 py-2 text-left"
                            onClick={() => addTile(report)}
                          >
                            <span className="flex min-w-0 flex-col items-start gap-0.5">
                              <span className="truncate font-medium">{report.name}</span>
                              <span className="text-xs text-muted-foreground">{t(`reports.list.types.${report.type}`, report.type)}</span>
                            </span>
                            <Plus className="size-4 text-muted-foreground" aria-hidden />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </aside>
            ) : null}

            <section className={editing ? 'lg:col-span-3' : ''}>
              {layout.tiles.length === 0 ? (
                <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
                  {editing
                    ? t('reports.dashboards.detail.tiles.emptyComposer', 'Add reports from the library to place tiles.')
                    : canEdit
                      ? t('reports.dashboards.detail.tiles.emptyEditable', 'This dashboard has no tiles yet. Click Edit to add some.')
                      : t('reports.dashboards.detail.tiles.emptyReadOnly', 'This dashboard has no tiles yet.')}
                </div>
              ) : (
                <DashboardGrid
                  tiles={layout.tiles}
                  grid={layout.grid}
                  editing={editing}
                  onLayoutChange={handleLayoutChange}
                  renderTile={renderTile}
                />
              )}
            </section>
          </div>
        </div>
        {bindingsTile ? (
          <TileBindingsDialog
            open={Boolean(bindingsTile)}
            onOpenChange={(open) => { if (!open) setBindingsTileId(null) }}
            tileTitle={bindingsTile.title || reportsById.get(bindingsTile.reportId)?.name || bindingsTile.id}
            reportParameters={reportsById.get(bindingsTile.reportId)?.parameters ?? []}
            dashboardParameters={dashboardParams}
            value={bindingsTile.paramBindings ?? EMPTY_BINDINGS}
            onApply={(next) => updateTile(bindingsTile.id, { paramBindings: Object.keys(next).length > 0 ? next : undefined })}
          />
        ) : null}
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
