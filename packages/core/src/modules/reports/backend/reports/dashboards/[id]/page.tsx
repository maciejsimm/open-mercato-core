"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { ArrowLeft, Play, Save, Trash2, Plus, X, GripVertical } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

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
}

type TileRunResult = {
  tileId: string
  reportId: string
  mode: string
  rows?: Record<string, unknown>[]
  total?: number
  meta?: Record<string, unknown>
  error?: { code?: string; message?: string }
}

const DEFAULT_LAYOUT: DashboardLayout = {
  grid: { cols: 12, rowHeight: 80, gap: 8 },
  tiles: [],
}

const TILE_MODES: TileMode[] = ['inline', 'summary', 'chart-only']

function parseLayout(raw: unknown): DashboardLayout {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LAYOUT, tiles: [] }
  const obj = raw as Record<string, unknown>
  const gridRaw = obj.grid && typeof obj.grid === 'object' ? (obj.grid as Record<string, unknown>) : {}
  const grid = {
    cols: typeof gridRaw.cols === 'number' ? gridRaw.cols : 12,
    rowHeight: typeof gridRaw.rowHeight === 'number' ? gridRaw.rowHeight : 80,
    gap: typeof gridRaw.gap === 'number' ? gridRaw.gap : 8,
  }
  const tilesRaw = Array.isArray(obj.tiles) ? obj.tiles : []
  const tiles: Tile[] = []
  for (const entry of tilesRaw) {
    if (!entry || typeof entry !== 'object') continue
    const ti = entry as Record<string, unknown>
    if (typeof ti.id !== 'string' || typeof ti.reportId !== 'string') continue
    const mode = TILE_MODES.includes(ti.mode as TileMode) ? (ti.mode as TileMode) : 'inline'
    tiles.push({
      id: ti.id,
      reportId: ti.reportId,
      x: typeof ti.x === 'number' ? ti.x : 0,
      y: typeof ti.y === 'number' ? ti.y : 0,
      w: typeof ti.w === 'number' && ti.w > 0 ? ti.w : 6,
      h: typeof ti.h === 'number' && ti.h > 0 ? ti.h : 4,
      mode,
      title: typeof ti.title === 'string' ? ti.title : undefined,
    })
  }
  return { grid, tiles }
}

function nextTileId(layout: DashboardLayout): string {
  let counter = 1
  const used = new Set(layout.tiles.map((t) => t.id))
  while (used.has(`tile_${counter}`)) counter += 1
  return `tile_${counter}`
}

export default function DashboardComposerPage({ params }: { params?: { id?: string } }) {
  const router = useRouter()
  const t = useT()
  const tRef = React.useRef(t)
  React.useEffect(() => { tRef.current = t }, [t])
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const dashboardId = params?.id ?? ''

  const [dashboard, setDashboard] = React.useState<DashboardDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [layout, setLayout] = React.useState<DashboardLayout>(DEFAULT_LAYOUT)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isRunning, setIsRunning] = React.useState(false)
  const [isDirty, setIsDirty] = React.useState(false)
  const [runResults, setRunResults] = React.useState<Map<string, TileRunResult>>(new Map())
  const [availableReports, setAvailableReports] = React.useState<ReportOption[]>([])

  React.useEffect(() => {
    if (!dashboardId) return
    let active = true
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const search = new URLSearchParams({ id: dashboardId, pageSize: '1' })
        const call = await apiCall<{ items?: DashboardDetail[] }>(
          `/api/reports/dashboards?${search.toString()}`,
          undefined,
          { fallback: { items: [] } },
        )
        if (!active) return
        if (!call.ok) {
          setLoadError(tRef.current('reports.dashboards.detail.error.load', `Failed to load dashboard (HTTP ${call.status}).`))
          return
        }
        const items = Array.isArray(call.result?.items) ? call.result!.items! : []
        const found = items[0]
        if (!found) {
          setLoadError(tRef.current('reports.dashboards.detail.error.notFound', 'Dashboard not found or not visible.'))
          return
        }
        setDashboard(found)
        setName(found.name)
        setDescription(found.description ?? '')
        setLayout(parseLayout(found.layout))

        const reportsCall = await apiCall<{ items?: ReportOption[] }>('/api/reports/reports?pageSize=100', undefined, { fallback: { items: [] } })
        if (!active) return
        if (reportsCall.ok && Array.isArray(reportsCall.result?.items)) {
          setAvailableReports(reportsCall.result!.items!.map((r) => ({ id: r.id, name: r.name, type: r.type, datasetId: r.datasetId })))
        }
      } catch (err) {
        if (active) {
          const message = err instanceof Error ? err.message : tRef.current('reports.dashboards.detail.error.load', 'Failed to load dashboard.')
          setLoadError(message)
        }
      } finally {
        setIsLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [dashboardId])

  React.useEffect(() => {
    if (!isLoading) return
    const handle = window.setTimeout(() => {
      setIsLoading(false)
      setLoadError(tRef.current('reports.dashboards.detail.error.loadTimeout', 'Loading timed out after 15 s. Check the network tab and reload the page.'))
    }, 15_000)
    return () => window.clearTimeout(handle)
  }, [isLoading])

  const canEdit = dashboard?.permission === 'edit'
  const markDirty = React.useCallback(() => setIsDirty(true), [])

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    if (!canEdit) return
    const { active, over } = event
    if (!over || active.id === over.id) return
    setLayout((prev) => {
      const oldIndex = prev.tiles.findIndex((tile) => tile.id === active.id)
      const newIndex = prev.tiles.findIndex((tile) => tile.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return prev
      return { ...prev, tiles: arrayMove(prev.tiles, oldIndex, newIndex) }
    })
    markDirty()
  }, [canEdit, markDirty])

  const addTile = React.useCallback((report: ReportOption) => {
    setLayout((prev) => {
      const id = nextTileId(prev)
      const yMax = prev.tiles.reduce((max, t) => Math.max(max, t.y + t.h), 0)
      const next: Tile = { id, reportId: report.id, x: 0, y: yMax, w: 12, h: 4, mode: 'inline', title: report.name }
      return { ...prev, tiles: [...prev.tiles, next] }
    })
    markDirty()
  }, [markDirty])

  const updateTile = React.useCallback((id: string, patch: Partial<Tile>) => {
    setLayout((prev) => ({ ...prev, tiles: prev.tiles.map((tile) => (tile.id === id ? { ...tile, ...patch } : tile)) }))
    markDirty()
  }, [markDirty])

  const removeTile = React.useCallback((id: string) => {
    setLayout((prev) => ({ ...prev, tiles: prev.tiles.filter((tile) => tile.id !== id) }))
    setRunResults((prev) => { const next = new Map(prev); next.delete(id); return next })
    markDirty()
  }, [markDirty])

  const handleSave = React.useCallback(async () => {
    if (!dashboard || !canEdit) return
    setIsSaving(true)
    try {
      await apiCallOrThrow('/api/reports/dashboards', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: dashboard.id,
          name: name.trim() || dashboard.name,
          description: description.trim() ? description.trim() : null,
          layout,
          version: dashboard.version,
        }),
      })
      flash(t('reports.dashboards.detail.success.save', 'Dashboard saved.'), 'success')
      setIsDirty(false)
      setDashboard((prev) => prev ? {
        ...prev,
        name: name.trim() || prev.name,
        description: description.trim() || null,
        layout,
        version: prev.version + 1,
      } : prev)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('reports.dashboards.detail.error.save', 'Failed to save dashboard.')
      flash(message, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [canEdit, dashboard, description, layout, name, t])

  const handleRun = React.useCallback(async () => {
    if (!dashboard) return
    if (isDirty) {
      const confirmed = await confirm({
        title: t('reports.dashboards.detail.run.unsavedConfirm', 'You have unsaved changes. Run the saved version anyway?'),
        variant: 'destructive',
      })
      if (!confirmed) return
    }
    setIsRunning(true)
    setRunResults(new Map())
    try {
      const result = await readApiResultOrThrow<{ tiles?: TileRunResult[] }>(
        `/api/reports/dashboards/${encodeURIComponent(dashboard.id)}/run`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ params: {} }),
        },
      )
      const tiles = Array.isArray(result?.tiles) ? result!.tiles! : []
      const map = new Map<string, TileRunResult>()
      for (const tile of tiles) map.set(tile.tileId, tile)
      setRunResults(map)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('reports.dashboards.detail.error.run', 'Failed to run dashboard.')
      flash(message, 'error')
    } finally {
      setIsRunning(false)
    }
  }, [confirm, dashboard, isDirty, t])

  const handleDelete = React.useCallback(async () => {
    if (!dashboard || !canEdit) return
    const confirmed = await confirm({
      title: t('reports.dashboards.detail.delete.confirm', 'Delete dashboard "{name}"?').replace('{name}', dashboard.name),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await apiCallOrThrow(`/api/reports/dashboards?id=${encodeURIComponent(dashboard.id)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
      })
      flash(t('reports.dashboards.detail.success.delete', 'Dashboard deleted.'), 'success')
      router.push('/backend/reports/dashboards')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('reports.dashboards.detail.error.delete', 'Failed to delete dashboard.')
      flash(message, 'error')
    }
  }, [canEdit, confirm, dashboard, router, t])

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

  if (loadError || !dashboard) {
    return (
      <Page>
        <PageBody>
          <div className="rounded-md border border-status-error-border bg-status-error-bg px-4 py-6">
            <p className="text-sm text-status-error-text">{loadError ?? t('reports.dashboards.detail.error.notFound', 'Dashboard not found.')}</p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href="/backend/reports/dashboards">
                <ArrowLeft className="size-4" aria-hidden />
                <span>{t('reports.dashboards.detail.actions.backToList', 'Back to dashboards')}</span>
              </Link>
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  const usedReportIds = new Set(layout.tiles.map((tile) => tile.reportId))
  const addableReports = availableReports.filter((report) => !usedReportIds.has(report.id))

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
                <h1 className="text-xl font-semibold text-foreground">{dashboard.name}</h1>
                <p className="text-xs text-muted-foreground">
                  {t('reports.dashboards.detail.metaLine', '{count} tiles').replace('{count}', String(layout.tiles.length))}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={handleRun} disabled={isRunning || layout.tiles.length === 0}>
                <Play className="size-4" aria-hidden />
                <span>{isRunning ? t('reports.dashboards.detail.actions.running', 'Running…') : t('reports.dashboards.detail.actions.run', 'Run')}</span>
              </Button>
              {canEdit ? (
                <Button type="button" onClick={handleSave} disabled={isSaving || !isDirty}>
                  <Save className="size-4" aria-hidden />
                  <span>{isSaving ? t('reports.dashboards.detail.actions.saving', 'Saving…') : t('reports.dashboards.detail.actions.save', 'Save')}</span>
                </Button>
              ) : null}
              {canEdit ? (
                <Button type="button" variant="destructive" onClick={handleDelete}>
                  <Trash2 className="size-4" aria-hidden />
                  <span>{t('reports.dashboards.detail.actions.delete', 'Delete')}</span>
                </Button>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="space-y-3 rounded-md border border-border bg-card p-4 lg:col-span-1">
              <h2 className="text-overline text-muted-foreground">{t('reports.dashboards.detail.sections.metadata', 'Metadata')}</h2>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">{t('reports.dashboards.detail.fields.name', 'Name')}</span>
                <Input value={name} onChange={(e) => { setName(e.target.value); markDirty() }} disabled={!canEdit || isSaving} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">{t('reports.dashboards.detail.fields.description', 'Description')}</span>
                <Textarea value={description} onChange={(e) => { setDescription(e.target.value); markDirty() }} disabled={!canEdit || isSaving} rows={3} />
              </label>

              <h2 className="text-overline text-muted-foreground pt-2">{t('reports.dashboards.detail.sections.addTile', 'Add tile')}</h2>
              {addableReports.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {availableReports.length === 0
                    ? t('reports.dashboards.detail.add.noReports', 'No reports available — create some first.')
                    : t('reports.dashboards.detail.add.allAdded', 'Every visible report is already a tile.')}
                </p>
              ) : (
                <ul className="space-y-1 max-h-96 overflow-y-auto">
                  {addableReports.map((report) => (
                    <li key={report.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between rounded-md border border-border/60 bg-background px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                        disabled={!canEdit}
                        onClick={() => addTile(report)}
                      >
                        <span className="flex flex-col items-start gap-0.5">
                          <span className="font-medium">{report.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">{report.type} · {report.datasetId}</span>
                        </span>
                        <Plus className="size-4 text-muted-foreground" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-3 rounded-md border border-border bg-card p-4 lg:col-span-2">
              <h2 className="text-overline text-muted-foreground">{t('reports.dashboards.detail.sections.tiles', 'Tiles')}</h2>
              {layout.tiles.length === 0 ? (
                <p className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                  {t('reports.dashboards.detail.tiles.empty', 'Drop reports from the left sidebar to add tiles.')}
                </p>
              ) : (
                <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={layout.tiles.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                    <ul className="space-y-2">
                      {layout.tiles.map((tile) => (
                        <SortableTile
                          key={tile.id}
                          tile={tile}
                          report={availableReports.find((r) => r.id === tile.reportId)}
                          canEdit={canEdit}
                          isRunning={isRunning}
                          result={runResults.get(tile.id) ?? null}
                          onPatch={(patch) => updateTile(tile.id, patch)}
                          onRemove={() => removeTile(tile.id)}
                          t={t}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              )}
            </section>
          </div>
        </div>
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}

type SortableTileProps = {
  tile: Tile
  report: ReportOption | undefined
  canEdit: boolean
  isRunning: boolean
  result: TileRunResult | null
  onPatch: (patch: Partial<Tile>) => void
  onRemove: () => void
  t: ReturnType<typeof useT>
}

function SortableTile({ tile, report, canEdit, isRunning, result, onPatch, onRemove, t }: SortableTileProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: tile.id, disabled: !canEdit })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  }

  const rows = result?.rows ?? []
  const fields = Array.isArray(result?.meta?.fields) ? (result!.meta!.fields as string[]) : (rows[0] ? Object.keys(rows[0]) : [])

  return (
    <li ref={setNodeRef} style={style} className="rounded-md border border-border bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        {canEdit ? (
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label={t('reports.dashboards.detail.tiles.dragHandle', 'Drag to reorder')}
            className="cursor-grab touch-none rounded-sm p-1 hover:bg-muted active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4 text-muted-foreground" aria-hidden />
          </button>
        ) : null}
        <Input
          value={tile.title ?? ''}
          onChange={(e) => onPatch({ title: e.target.value || undefined })}
          disabled={!canEdit}
          placeholder={report?.name ?? tile.reportId}
          className="h-8 max-w-md text-sm"
        />
        <span className="font-mono text-xs text-muted-foreground">{report ? `${report.type} · ${report.datasetId}` : tile.reportId}</span>
        <select
          value={tile.mode}
          onChange={(e) => onPatch({ mode: e.target.value as TileMode })}
          disabled={!canEdit}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          {TILE_MODES.map((mode) => (
            <option key={mode} value={mode}>{t(`reports.dashboards.detail.tiles.mode.${mode}`, mode)}</option>
          ))}
        </select>
        <button
          type="button"
          className={cn('ml-auto rounded-sm p-1 hover:bg-muted disabled:opacity-50')}
          disabled={!canEdit}
          onClick={onRemove}
          aria-label={t('reports.dashboards.detail.tiles.remove', 'Remove tile')}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="px-3 py-2">
        {isRunning ? (
          <div className="flex items-center justify-center py-6">
            <Spinner className="size-5" />
          </div>
        ) : result?.error ? (
          <div className="rounded-md border border-status-warning-border bg-status-warning-bg px-3 py-2 text-sm text-status-warning-text">
            {result.error.message ?? t('reports.dashboards.detail.tiles.error', 'Failed to render tile.')}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {result ? t('reports.dashboards.detail.tiles.emptyRows', 'No rows.') : t('reports.dashboards.detail.tiles.notRun', 'Click Run to render this tile.')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {fields.map((col) => (
                    <th key={col} className="px-3 py-1.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 25).map((row, idx) => (
                  <tr key={idx} className="border-b border-border/60 last:border-b-0">
                    {fields.map((col) => {
                      const value = row[col]
                      let display: string
                      if (value == null) display = '—'
                      else if (typeof value === 'object') display = JSON.stringify(value)
                      else display = String(value)
                      return <td key={col} className="px-3 py-1.5 align-top">{display}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </li>
  )
}
