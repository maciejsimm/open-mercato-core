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
import { ArrowLeft, Play, Save, Trash2, Plus, X, GripVertical, Download, Settings, Pencil, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { ReportChart } from '../../../widgets/ReportChart'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@open-mercato/ui/primitives/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@open-mercato/ui/primitives/tabs'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  MeasuringStrategy,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  arrayMove,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import {
  measureAlias,
  type ChartKind,
  type ColumnFormats,
  type DateRangeToken,
  type FieldFormat,
  type FilterOp,
  type MeasureExpr,
  type ReportColumnDescriptor,
  type ReportType,
  type Sort,
} from '@open-mercato/shared/modules/reports/dsl'
import {
  REPORT_TYPES,
  SINGLE_SERIES_CHART_KINDS,
  defaultDefinition,
  reconcileChartDefinition,
  switchDefinitionType,
  type BuilderChartSpec,
  type BuilderDateRangeFilter,
  type BuilderDefinition,
  type BuilderFilter,
  type BuilderLiteralFilter,
  type ChartDefinition,
  type DraftStash,
  type FlatListDefinition,
  type GroupedDefinition,
  type PivotDefinition,
  type SummaryDefinition,
} from '../../../lib/definition-migrate'
import { ResultTable, buildSeriesLabels, measureLabel } from './components/ResultView'
import { SortEditor } from './components/SortEditor'
import { buildPreviewRequestBody, buildTypeSwitchMessage, filterFieldsByQuery } from './components/builder-helpers'
import { readJsonFromLocalStorage, writeJsonToLocalStorage } from '@open-mercato/shared/lib/browser/safeLocalStorage'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'

type Aggregation = MeasureExpr['aggregation']
type ChartType = ChartKind
type SortShape = Sort
type LiteralFilter = BuilderLiteralFilter
type DateRangeFilter = BuilderDateRangeFilter
type FilterShape = BuilderFilter
type ChartSpec = BuilderChartSpec
type FlatListDef = FlatListDefinition
type GroupedDef = GroupedDefinition
type PivotDef = PivotDefinition
type ChartDef = ChartDefinition
type SummaryDef = SummaryDefinition
type Definition = BuilderDefinition

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

type EnumOption = string | number | { value: string | number; labelKey?: string }

type DatasetFieldRow = {
  key: string
  labelKey: string
  kind: string
  sortable?: boolean
  filterable?: boolean
  aggregations?: Aggregation[]
  /** Present for enum-kind fields when declared inline (not via dictionary). */
  options?: EnumOption[]
  dictionary?: string
}

type ParameterKind = 'string' | 'number' | 'boolean' | 'date' | 'date_range' | 'fk' | 'enum'

type ParameterDef = {
  key: string
  labelKey?: string
  kind: ParameterKind
  defaultValue?: unknown
  required?: boolean
  relatedDatasetId?: string
  options?: Array<string | number>
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
  meta?: { fields?: string[]; columns?: ReportColumnDescriptor[]; mixedCurrencyColumns?: string[] }
  error?: { code?: string; message?: string }
}

type PreviewIssue = { path: string; message: string }
type PreviewError = { message: string; issues: PreviewIssue[] }

function readPreviewError(body: unknown, fallback: string): PreviewError {
  const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined
  if (!error || typeof error !== 'object') return { message: fallback, issues: [] }
  const record = error as { message?: unknown; issues?: unknown }
  const issues: PreviewIssue[] = Array.isArray(record.issues)
    ? record.issues
        .map((issue): PreviewIssue | null => {
          if (!issue || typeof issue !== 'object') return null
          const entry = issue as { path?: unknown; message?: unknown }
          if (typeof entry.message !== 'string') return null
          return { path: typeof entry.path === 'string' ? entry.path : '', message: entry.message }
        })
        .filter((issue): issue is PreviewIssue => issue !== null)
    : []
  return { message: typeof record.message === 'string' ? record.message : fallback, issues }
}

const FORMAT_DATE_STYLES = new Set(['short', 'medium', 'long'])

function parseColumnFormats(raw: unknown): ColumnFormats | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: ColumnFormats = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const entry = value as Record<string, unknown>
    const format: FieldFormat = {}
    if (typeof entry.precision === 'number' && Number.isInteger(entry.precision)) format.precision = entry.precision
    if (typeof entry.dateStyle === 'string' && FORMAT_DATE_STYLES.has(entry.dateStyle)) {
      format.dateStyle = entry.dateStyle as FieldFormat['dateStyle']
    }
    if (entry.percent === true) format.percent = true
    if (entry.compact === true) format.compact = true
    if (Object.keys(format).length > 0) out[key] = format
  }
  return Object.keys(out).length > 0 ? out : undefined
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

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function parseDefinition(raw: unknown, fallbackType: ReportType): Definition {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const columnFormats = parseColumnFormats(obj.columnFormats)
  const parsed = parseDefinitionSlots(obj, fallbackType)
  return columnFormats ? { ...parsed, columnFormats } : parsed
}

function parseDefinitionSlots(obj: Record<string, unknown>, fallbackType: ReportType): Definition {
  const rawType = typeof obj.type === 'string' ? obj.type : fallbackType
  const type = REPORT_TYPES.find((candidate) => candidate === rawType) ?? fallbackType
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

function parseParameters(raw: unknown): ParameterDef[] {
  if (!Array.isArray(raw)) return []
  const allowedKinds: ParameterKind[] = ['string', 'number', 'boolean', 'date', 'date_range', 'fk', 'enum']
  const out: ParameterDef[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    if (typeof e.key !== 'string' || e.key.length === 0) continue
    const kind = allowedKinds.includes(e.kind as ParameterKind) ? (e.kind as ParameterKind) : 'string'
    const param: ParameterDef = {
      key: e.key,
      labelKey: typeof e.labelKey === 'string' && e.labelKey.length > 0 ? e.labelKey : undefined,
      kind,
      defaultValue: e.defaultValue,
      required: typeof e.required === 'boolean' ? e.required : undefined,
      relatedDatasetId: typeof e.relatedDatasetId === 'string' ? e.relatedDatasetId : undefined,
      options: Array.isArray(e.options)
        ? e.options
            .map((v) => (typeof v === 'string' || typeof v === 'number' ? v : null))
            .filter((v): v is string | number => v !== null)
        : undefined,
    }
    out.push(param)
  }
  return out
}

/**
 * Apply a "drop field into zone" operation to the definition. Used by the
 * drag-and-drop layer (3.3b) and by the click-to-add code path so both
 * interactions stay in sync.
 */
function addFieldToZone(
  prev: Definition,
  zoneId: string,
  fieldKey: string,
  fieldByKey: Map<string, DatasetFieldRow>,
): Definition {
  const field = fieldByKey.get(fieldKey)
  const defaultMeasure = (): MeasureExpr | null => {
    if (!field) return null
    const allowed = fieldAllowedAggregations(field)
    return { field: fieldKey, aggregation: allowed[0] ?? 'count' }
  }
  if (prev.type === 'flat_list') {
    if (zoneId === 'fields' && !prev.fields.includes(fieldKey)) {
      return { ...prev, fields: [...prev.fields, fieldKey] }
    }
    if (zoneId === 'sort') {
      const dir = prev.sort[0]?.dir ?? 'asc'
      return { ...prev, sort: [{ field: fieldKey, dir }] }
    }
    return prev
  }
  if (prev.type === 'grouped') {
    if (zoneId === 'fields' && !prev.fields.includes(fieldKey)) {
      return { ...prev, fields: [...prev.fields, fieldKey] }
    }
    if (zoneId === 'groupBy' && !prev.groupBy.includes(fieldKey)) {
      return { ...prev, groupBy: [...prev.groupBy, fieldKey] }
    }
    if (zoneId === 'measures') {
      const m = defaultMeasure()
      if (!m) return prev
      return { ...prev, measures: [...prev.measures, m] }
    }
    if (zoneId === 'sort') {
      const dir = prev.sort[0]?.dir ?? 'asc'
      return { ...prev, sort: [{ field: fieldKey, dir }] }
    }
    return prev
  }
  if (prev.type === 'pivot') {
    if (zoneId === 'rows' && !prev.rows.includes(fieldKey) && !prev.cols.includes(fieldKey)) {
      return { ...prev, rows: [...prev.rows, fieldKey] }
    }
    if (zoneId === 'cols' && !prev.cols.includes(fieldKey) && !prev.rows.includes(fieldKey)) {
      return { ...prev, cols: [...prev.cols, fieldKey] }
    }
    if (zoneId === 'value') {
      const m = defaultMeasure()
      if (!m) return prev
      return { ...prev, value: m }
    }
    return prev
  }
  if (prev.type === 'chart') {
    if (zoneId === 'groupBy' && !prev.groupBy.includes(fieldKey)) {
      return { ...prev, groupBy: [...prev.groupBy, fieldKey] }
    }
    if (zoneId === 'measures') {
      const m = defaultMeasure()
      if (!m) return prev
      return { ...prev, measures: [...prev.measures, m] }
    }
    return prev
  }
  // summary
  if (zoneId === 'measures') {
    const m = defaultMeasure()
    if (!m) return prev
    return { ...prev, measures: [...prev.measures, m] }
  }
  return prev
}

/**
 * Client validity guard for the live preview. Mirrors the server rules for
 * charts (F13b): with an explicit `groupBy` the X field must be one of its
 * keys; without one, the X field is the implicit group key.
 */
function isPreviewable(def: Definition): boolean {
  switch (def.type) {
    case 'flat_list':
      return def.fields.length > 0
    case 'grouped':
      return def.groupBy.length > 0 && def.measures.length > 0
    case 'pivot':
      return def.rows.length > 0 && !!def.value && !!def.value.field
    case 'chart': {
      if (def.measures.length === 0 || !def.chart.xField || def.chart.yFields.length === 0) return false
      return def.groupBy.length === 0 || def.groupBy.includes(def.chart.xField)
    }
    case 'summary':
      return def.measures.length > 0
  }
}

const PREVIEW_DEBOUNCE_MS = 500
const FIELD_SIDEBAR_STORAGE_KEY = 'om:reports:builder:fields-sidebar'

const FIELD_DRAG_PREFIX = 'field:'
const ZONE_DROP_PREFIX = 'zone:'
const CHIP_PREFIX = 'chip:'
const REMOVE_DROP_ID = 'remove-target'
const MEASURE_ZONES = new Set(['measures', 'value'])

function chipId(zoneId: string, key: string): string {
  return `${CHIP_PREFIX}${zoneId}:${encodeURIComponent(key)}`
}

function parseChipId(id: string): { zoneId: string; key: string } | null {
  if (!id.startsWith(CHIP_PREFIX)) return null
  const rest = id.slice(CHIP_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep <= 0) return null
  return { zoneId: rest.slice(0, sep), key: decodeURIComponent(rest.slice(sep + 1)) }
}

/** Stable chip keys for measures: the alias, suffixed only when two measures share one. */
function measureChipKeys(measures: readonly MeasureExpr[]): string[] {
  const seen = new Map<string, number>()
  return measures.map((m) => {
    const alias = measureAlias(m)
    const count = seen.get(alias) ?? 0
    seen.set(alias, count + 1)
    return count === 0 ? alias : `${alias}#${count + 1}`
  })
}

function zoneMeasures(def: Definition, zoneId: string): MeasureExpr[] | null {
  if (zoneId === 'value' && def.type === 'pivot') return def.value && def.value.field ? [def.value] : []
  if (zoneId === 'measures' && (def.type === 'grouped' || def.type === 'chart' || def.type === 'summary')) return def.measures
  return null
}

function zoneStrings(def: Definition, zoneId: string): string[] | null {
  if (zoneId === 'fields' && (def.type === 'flat_list' || def.type === 'grouped')) return def.fields
  if (zoneId === 'groupBy' && (def.type === 'grouped' || def.type === 'chart')) return def.groupBy
  if (def.type === 'pivot' && zoneId === 'rows') return def.rows
  if (def.type === 'pivot' && zoneId === 'cols') return def.cols
  return null
}

function zoneChipKeys(def: Definition, zoneId: string): string[] {
  const measures = zoneMeasures(def, zoneId)
  if (measures) return measureChipKeys(measures)
  return zoneStrings(def, zoneId) ?? []
}

/** Dataset field a chip binds to (measure chips bind to `measure.field`). */
function resolveChipFieldKey(def: Definition, zoneId: string, key: string): string | null {
  const measures = zoneMeasures(def, zoneId)
  if (measures) {
    const idx = measureChipKeys(measures).indexOf(key)
    return idx >= 0 ? measures[idx].field : null
  }
  return (zoneStrings(def, zoneId) ?? []).includes(key) ? key : null
}

/**
 * Collision detection for the builder (F14): only droppables that make sense
 * for the active drag compete — zones for sidebar fields, sibling chips plus
 * the remove strip for chips. The pointer decides (`pointerWithin`), falling
 * back to `rectIntersection`; among hits under the pointer the innermost
 * (smallest) droppable wins.
 */
const builderCollisionDetection: CollisionDetection = (args) => {
  const activeId = String(args.active.id)
  const activeChip = parseChipId(activeId)
  const droppableContainers = args.droppableContainers.filter((container) => {
    if (container.disabled) return false
    const id = String(container.id)
    if (id === REMOVE_DROP_ID) return activeChip !== null
    if (id.startsWith(ZONE_DROP_PREFIX)) return activeChip === null
    const chip = parseChipId(id)
    return chip !== null && activeChip !== null && chip.zoneId === activeChip.zoneId
  })
  const scoped = { ...args, droppableContainers }
  const underPointer = pointerWithin(scoped)
  if (underPointer.length === 0) return rectIntersection(scoped)
  const area = (id: string | number): number => {
    const rect = args.droppableRects.get(id)
    return rect ? rect.width * rect.height : Number.POSITIVE_INFINITY
  }
  return [...underPointer].sort((left, right) => area(left.id) - area(right.id))
}

/**
 * Reorder a chip within its zone (`toKey` = the chip it was dropped on), or
 * remove it when `toKey` is null. Chips are addressed by stable keys — the
 * field key, or the measure alias — so ids stay valid across reorders.
 */
function moveChipInZone(
  prev: Definition,
  zoneId: string,
  fromKey: string,
  toKey: string | null,
): Definition {
  const keys = zoneChipKeys(prev, zoneId)
  const fromIndex = keys.indexOf(fromKey)
  if (fromIndex < 0) return prev
  const toIndex = toKey === null ? -1 : keys.indexOf(toKey)
  if (toKey !== null && (toIndex < 0 || toIndex === fromIndex)) return prev
  const apply = <T,>(list: T[]): T[] =>
    toKey === null ? list.filter((_, i) => i !== fromIndex) : arrayMove(list, fromIndex, toIndex)

  if (zoneId === 'value' && prev.type === 'pivot') {
    return toKey === null ? { ...prev, value: null } : prev
  }
  if (MEASURE_ZONES.has(zoneId)) {
    if (prev.type === 'grouped' || prev.type === 'chart' || prev.type === 'summary') {
      return { ...prev, measures: apply(prev.measures) }
    }
    return prev
  }
  if (zoneId === 'fields' && (prev.type === 'flat_list' || prev.type === 'grouped')) return { ...prev, fields: apply(prev.fields) }
  if (zoneId === 'groupBy' && (prev.type === 'grouped' || prev.type === 'chart')) return { ...prev, groupBy: apply(prev.groupBy) }
  if (prev.type === 'pivot' && zoneId === 'rows') return { ...prev, rows: apply(prev.rows) }
  if (prev.type === 'pivot' && zoneId === 'cols') return { ...prev, cols: apply(prev.cols) }
  return prev
}

export default function ReportBuilderPage({ params }: { params?: { id?: string } }) {
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
  const [parameters, setParameters] = React.useState<ParameterDef[]>([])
  const [isSaving, setIsSaving] = React.useState(false)
  const [isRunning, setIsRunning] = React.useState(false)
  const [isDirty, setIsDirty] = React.useState(false)
  const [runResult, setRunResult] = React.useState<ReportRunResponse | null>(null)
  const [previewResult, setPreviewResult] = React.useState<ReportRunResponse | null>(null)
  const [isPreviewing, setIsPreviewing] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<PreviewError | null>(null)
  const [viewMode, setViewMode] = React.useState<'edit' | 'run'>('edit')
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [fieldsCollapsed, setFieldsCollapsed] = React.useState(false)
  React.useEffect(() => {
    setFieldsCollapsed(readJsonFromLocalStorage<boolean>(FIELD_SIDEBAR_STORAGE_KEY, false) === true)
  }, [])
  const setFieldsSidebarCollapsed = React.useCallback((next: boolean) => {
    setFieldsCollapsed(next)
    writeJsonToLocalStorage(FIELD_SIDEBAR_STORAGE_KEY, next)
  }, [])

  // Load effect — depends only on reportId. We deliberately do NOT gate
  // `setIsLoading(false)` on a cancelled flag any more: an earlier bullet
  // (3.3a) only dropped `t` from the deps but the spinner kept reproducing
  // in dev. Always clearing the loading flag is safer than ever leaving the
  // user staring at a spinner — if the component unmounted, React swallows
  // the state set with a warning we can act on.
  React.useEffect(() => {
    if (!reportId) return
    let active = true
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
        if (!active) return
        if (!reportCall.ok) {
          setLoadError(
            tRef.current(
              'reports.detail.error.load',
              `Failed to load report (HTTP ${reportCall.status}).`,
            ),
          )
          if (typeof console !== 'undefined') {
            console.warn('[reports/detail] report list call failed', {
              status: reportCall.status,
              reportId,
            })
          }
          return
        }
        const items = Array.isArray(reportCall.result?.items) ? reportCall.result!.items! : []
        const found = items[0]
        if (!found) {
          setLoadError(tRef.current('reports.detail.error.notFound', 'Report not found or not visible.'))
          if (typeof console !== 'undefined') {
            console.warn('[reports/detail] report not found in list response', {
              reportId,
              totalReturned: items.length,
            })
          }
          return
        }
        setReport(found)
        setName(found.name)
        setDescription(found.description ?? '')
        setDefinition(parseDefinition(found.definition, found.type))
        draftStash.current = {}
        setParameters(parseParameters(found.parameters))

        const datasetCall = await apiCall<DatasetDetail>(
          `/api/reports/datasets/${encodeURIComponent(found.datasetId)}`,
        )
        if (!active) return
        if (datasetCall.ok && datasetCall.result) {
          setDataset(datasetCall.result)
        } else {
          setLoadError(
            tRef.current(
              'reports.detail.error.datasetLoad',
              `Failed to load dataset '${found.datasetId}' (HTTP ${datasetCall.status}).`,
            ),
          )
          if (typeof console !== 'undefined') {
            console.warn('[reports/detail] dataset call failed', {
              datasetId: found.datasetId,
              status: datasetCall.status,
            })
          }
        }
      } catch (err) {
        const message = err instanceof Error
          ? err.message
          : tRef.current('reports.detail.error.load', 'Failed to load report.')
        if (typeof console !== 'undefined') {
          console.error('[reports/detail] load threw', err)
        }
        if (active) setLoadError(message)
      } finally {
        // Always clear the spinner, even if the effect was cancelled mid-flight
        // (React swallows the state set with a warning rather than leaving the
        // user stuck on a spinner forever).
        setIsLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [reportId])

  // Safety net: if loading has not resolved after 15 seconds, force-exit
  // the loading state and surface a generic error so the user can recover.
  React.useEffect(() => {
    if (!isLoading) return
    const handle = window.setTimeout(() => {
      setIsLoading(false)
      setLoadError(
        tRef.current(
          'reports.detail.error.loadTimeout',
          'Loading timed out after 15 s. Check the network tab and reload the page.',
        ),
      )
      if (typeof console !== 'undefined') {
        console.warn('[reports/detail] load timed out after 15 s', { reportId })
      }
    }, 15_000)
    return () => window.clearTimeout(handle)
  }, [isLoading, reportId])

  const datasetFields = dataset?.fields ?? []
  const canEdit = report?.permission === 'edit'

  const markDirty = React.useCallback(() => setIsDirty(true), [])

  const editRevision = React.useRef(0)
  const draftStash = React.useRef<DraftStash>({})

  const applyDefinition = React.useCallback((update: (prev: Definition) => Definition) => {
    setDefinition((prev) => {
      const next = reconcileChartDefinition(prev, update(prev))
      if (next !== prev) editRevision.current += 1
      return next
    })
    markDirty()
  }, [markDirty])

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const fieldByKey = React.useMemo(() => {
    const map = new Map<string, DatasetFieldRow>()
    for (const f of datasetFields) map.set(f.key, f)
    return map
  }, [datasetFields])

  const [activeDragFieldKey, setActiveDragFieldKey] = React.useState<string | null>(null)
  const [isDraggingChip, setIsDraggingChip] = React.useState(false)
  const activeDragField = activeDragFieldKey ? fieldByKey.get(activeDragFieldKey) ?? null : null

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    const id = String(event.active.id)
    if (id.startsWith(FIELD_DRAG_PREFIX)) {
      setIsDraggingChip(false)
      setActiveDragFieldKey(id.slice(FIELD_DRAG_PREFIX.length))
      return
    }
    const chip = parseChipId(id)
    setIsDraggingChip(chip !== null)
    setActiveDragFieldKey(chip ? resolveChipFieldKey(definition, chip.zoneId, chip.key) : null)
  }, [definition])

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    setActiveDragFieldKey(null)
    setIsDraggingChip(false)
    if (!canEdit) return
    const { active, over } = event
    if (!over) return
    const aid = String(active.id)
    const oid = String(over.id)

    if (aid.startsWith(FIELD_DRAG_PREFIX)) {
      const fieldKey = aid.slice(FIELD_DRAG_PREFIX.length)
      if (!oid.startsWith(ZONE_DROP_PREFIX)) return
      const targetZone = oid.slice(ZONE_DROP_PREFIX.length)
      applyDefinition((prev) => addFieldToZone(prev, targetZone, fieldKey, fieldByKey))
      return
    }

    const chip = parseChipId(aid)
    if (!chip) return
    if (oid === REMOVE_DROP_ID) {
      applyDefinition((prev) => moveChipInZone(prev, chip.zoneId, chip.key, null))
      return
    }
    const target = parseChipId(oid)
    if (!target || target.zoneId !== chip.zoneId || target.key === chip.key) return
    applyDefinition((prev) => moveChipInZone(prev, chip.zoneId, chip.key, target.key))
  }, [applyDefinition, canEdit, fieldByKey])

  const handleDragCancel = React.useCallback(() => {
    setActiveDragFieldKey(null)
    setIsDraggingChip(false)
  }, [])

  const handleTypeChange = React.useCallback((next: ReportType) => {
    if (!canEdit) return
    const result = switchDefinitionType(definition, next, draftStash.current, editRevision.current)
    draftStash.current = result.stash
    setDefinition(result.definition)
    if (result.dropped.length > 0) {
      flash(buildTypeSwitchMessage(next, result.dropped, fieldByKey, t), 'warning')
    }
    markDirty()
  }, [canEdit, definition, fieldByKey, markDirty, t])

  const handleColumnFormatChange = React.useCallback((key: string, format: FieldFormat | undefined) => {
    applyDefinition((prev) => {
      const nextFormats: ColumnFormats = { ...(prev.columnFormats ?? {}) }
      if (format) nextFormats[key] = format
      else delete nextFormats[key]
      const next: Definition = { ...prev }
      if (Object.keys(nextFormats).length > 0) next.columnFormats = nextFormats
      else delete next.columnFormats
      return next
    })
  }, [applyDefinition])

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
          parameters,
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
            parameters,
            version: prev.version + 1,
          }
        : prev)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('reports.detail.error.save', 'Failed to save report.')
      flash(message, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [canEdit, definition, description, name, parameters, report, t])

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
    setViewMode('run')
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

  const handleEditAgain = React.useCallback(() => {
    setViewMode('edit')
  }, [])

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

  // ----- Auto-preview (edit mode) ---------------------------------------
  // Re-runs an ad-hoc preview against /api/reports/preview whenever the
  // request body changes. The body keeps only query-relevant parameter
  // declarations (referenced by a filter, without labels), so typing a
  // parameter name or label never re-runs it. Debounced so a chip reorder /
  // typed alias doesn't fire on every keystroke; capped at 10 rows server-side
  // so the call is cheap. Skipped in run mode (the full result lives in
  // `runResult` and is updated by the explicit Run action instead).
  const previewToken = React.useRef(0)
  const previewDatasetId = report?.datasetId ?? null
  const previewBody = React.useMemo(
    () => (previewDatasetId ? buildPreviewRequestBody(previewDatasetId, definition, parameters) : null),
    [definition, parameters, previewDatasetId],
  )
  const previewable = React.useMemo(() => isPreviewable(definition), [definition])
  React.useEffect(() => {
    if (viewMode !== 'edit') return
    if (!previewBody) return
    // Heuristic validity guard: skip the call when the definition cannot
    // possibly return rows. The preview endpoint would reject these too,
    // but checking client-side keeps spinner noise down.
    if (!previewable) {
      setPreviewResult(null)
      setPreviewError(null)
      setIsPreviewing(false)
      return
    }

    const token = ++previewToken.current
    const handle = setTimeout(async () => {
      setIsPreviewing(true)
      try {
        const call = await apiCall<ReportRunResponse>('/api/reports/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: previewBody,
        })
        if (token !== previewToken.current) return
        if (call.ok) {
          setPreviewResult(call.result ?? null)
          setPreviewError(null)
        } else {
          setPreviewResult(null)
          setPreviewError(readPreviewError(
            call.result,
            tRef.current('reports.detail.preview.failed', 'Preview failed (HTTP {status}).', { status: call.status }),
          ))
        }
      } catch (err) {
        if (token !== previewToken.current) return
        setPreviewResult(null)
        setPreviewError({
          message: err instanceof Error && err.message
            ? err.message
            : tRef.current('reports.detail.preview.failedGeneric', 'Preview failed.'),
          issues: [],
        })
      } finally {
        if (token === previewToken.current) setIsPreviewing(false)
      }
    }, PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [viewMode, previewBody, previewable])

  // Show the spinner while the load is in flight AND for the brief frame
  // after `isLoading` flips false but before `report` is populated — without
  // this guard the "Report not found" panel flashes on every refresh because
  // `report` is `null` (initial state) and `loadError` is also `null` (the
  // load effect resets it from a useEffect, one frame after the render).
  if (isLoading || (!loadError && !report)) {
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
            viewMode={viewMode}
            onRun={handleRun}
            onSave={handleSave}
            onDelete={handleDelete}
            onEditAgain={handleEditAgain}
            onOpenSettings={() => setSettingsOpen(true)}
            t={t}
          />

          {viewMode === 'edit' ? (
            <DndContext
              sensors={dndSensors}
              collisionDetection={builderCollisionDetection}
              measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                {fieldsCollapsed ? (
                  <CollapsedFieldsRail onExpand={() => setFieldsSidebarCollapsed(false)} t={t} />
                ) : (
                  <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-60">
                    <div className="rounded-md border border-border bg-card p-3">
                      <TypeSelect
                        value={definition.type}
                        onChange={handleTypeChange}
                        canEdit={canEdit}
                        t={t}
                      />
                    </div>
                    <FieldList
                      fields={datasetFields}
                      hiddenPaths={dataset?.hiddenFieldPaths ?? []}
                      canEdit={canEdit}
                      isDraggingChip={isDraggingChip}
                      onCollapse={() => setFieldsSidebarCollapsed(true)}
                      t={t}
                    />
                  </aside>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                  {fieldsCollapsed ? (
                    <div className="rounded-md border border-border bg-card p-3 sm:max-w-xs">
                      <TypeSelect
                        value={definition.type}
                        onChange={handleTypeChange}
                        canEdit={canEdit}
                        t={t}
                      />
                    </div>
                  ) : null}
                  <EditorTabsCard
                    definition={definition}
                    parameters={parameters}
                    fields={datasetFields}
                    canEdit={canEdit}
                    onDefinitionChange={(next) => applyDefinition(() => next)}
                    onParametersChange={(next) => { setParameters(next); markDirty() }}
                    t={t}
                  />
                  <PreviewSection
                    definition={definition}
                    runResult={previewResult}
                    previewError={previewError}
                    isRunning={isPreviewing}
                    viewMode="edit"
                    fieldByKey={fieldByKey}
                    onColumnFormatChange={canEdit ? handleColumnFormatChange : undefined}
                    t={t}
                  />
                </div>
              </div>
              <DragOverlay dropAnimation={null}>
                {activeDragField ? (
                  <div className="pointer-events-none flex max-w-xs items-center gap-2 rounded-md border border-primary bg-popover px-3 py-2 text-sm shadow-lg">
                    <GripVertical className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{t(activeDragField.labelKey, activeDragField.key)}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground">{activeDragField.key}</span>
                    </div>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          ) : (
            <PreviewSection
              definition={definition}
              runResult={runResult}
              isRunning={isRunning}
              viewMode="run"
              fieldByKey={fieldByKey}
              t={t}
            />
          )}
        </div>
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          name={name}
          description={description}
          datasetId={report.datasetId}
          canEdit={canEdit}
          isSaving={isSaving}
          onNameChange={(value) => { setName(value); markDirty() }}
          onDescriptionChange={(value) => { setDescription(value); markDirty() }}
          onDelete={canEdit ? () => { setSettingsOpen(false); handleDelete() } : undefined}
          t={t}
        />
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
  viewMode: 'edit' | 'run'
  onRun: () => void
  onSave: () => void
  onDelete: () => void
  onEditAgain: () => void
  onOpenSettings: () => void
  t: ReturnType<typeof useT>
}

const EXPORT_FORMATS: Array<{ value: 'csv' | 'json' | 'xml' | 'markdown'; labelKey: string; fallback: string }> = [
  { value: 'csv', labelKey: 'reports.detail.actions.exportCsv', fallback: 'Export CSV' },
  { value: 'json', labelKey: 'reports.detail.actions.exportJson', fallback: 'Export JSON' },
  { value: 'xml', labelKey: 'reports.detail.actions.exportXml', fallback: 'Export XML' },
  { value: 'markdown', labelKey: 'reports.detail.actions.exportMarkdown', fallback: 'Export Markdown' },
]

function BuilderHeader({
  report,
  canEdit,
  isSaving,
  isRunning,
  isDirty,
  viewMode,
  onRun,
  onSave,
  onDelete,
  onEditAgain,
  onOpenSettings,
  t,
}: BuilderHeaderProps) {
  void onDelete
  const [exportOpen, setExportOpen] = React.useState(false)
  const exportRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!exportOpen) return
    function onDocClick(event: MouseEvent) {
      const node = exportRef.current
      if (node && event.target instanceof Node && !node.contains(event.target)) setExportOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [exportOpen])

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
        {viewMode === 'run' ? (
          <Button type="button" variant="outline" onClick={onEditAgain}>
            <Pencil className="size-4" aria-hidden />
            <span>{t('reports.detail.actions.edit', 'Edit')}</span>
          </Button>
        ) : null}
        {viewMode === 'edit' ? (
          <Button type="button" variant="outline" onClick={onRun} disabled={isRunning}>
            <Play className="size-4" aria-hidden />
            <span>{isRunning ? t('reports.detail.actions.running', 'Running…') : t('reports.detail.actions.run', 'Run')}</span>
          </Button>
        ) : null}
        <div className="relative" ref={exportRef}>
          <Button
            type="button"
            variant="outline"
            onClick={() => setExportOpen((prev) => !prev)}
            aria-expanded={exportOpen}
          >
            <Download className="size-4" aria-hidden />
            <span>{t('reports.detail.actions.export', 'Export')}</span>
          </Button>
          {exportOpen ? (
            <div className="absolute right-0 z-10 mt-1 w-48 rounded-md border border-border bg-popover p-1 shadow-lg">
              <ul className="space-y-0.5">
                {EXPORT_FORMATS.map((fmt) => {
                  const href = `/api/reports/reports/${encodeURIComponent(report.id)}/export?format=${fmt.value}`
                  return (
                    <li key={fmt.value}>
                      <a
                        href={href}
                        className="block w-full rounded-sm px-3 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={() => setExportOpen(false)}
                      >
                        {t(fmt.labelKey, fmt.fallback)}
                      </a>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}
        </div>
        {canEdit && viewMode === 'edit' ? (
          <Button type="button" onClick={onSave} disabled={isSaving || !isDirty}>
            <Save className="size-4" aria-hidden />
            <span>{isSaving ? t('reports.detail.actions.saving', 'Saving…') : t('reports.detail.actions.save', 'Save')}</span>
          </Button>
        ) : null}
        {canEdit && viewMode === 'edit' ? (
          <Button type="button" variant="outline" onClick={onOpenSettings} aria-label={t('reports.detail.actions.settings', 'Settings')}>
            <Settings className="size-4" aria-hidden />
            <span>{t('reports.detail.actions.settings', 'Settings')}</span>
          </Button>
        ) : null}
      </div>
    </div>
  )
}

// ---------- Settings dialog ----------

type SettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  description: string
  datasetId: string
  canEdit: boolean
  isSaving: boolean
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onDelete?: () => void
  t: ReturnType<typeof useT>
}

function SettingsDialog({
  open,
  onOpenChange,
  name,
  description,
  datasetId,
  canEdit,
  isSaving,
  onNameChange,
  onDescriptionChange,
  onDelete,
  t,
}: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('reports.detail.sections.metadata', 'Report settings')}</DialogTitle>
          <DialogDescription>
            {t('reports.detail.settings.hint', 'Name and description of this report. The dataset is fixed at creation time.')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
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
        </div>
        <DialogFooter className="sm:justify-between">
          {onDelete ? (
            <Button type="button" variant="destructive" onClick={onDelete}>
              <Trash2 className="size-4" aria-hidden />
              <span>{t('reports.detail.actions.delete', 'Delete report')}</span>
            </Button>
          ) : <span />}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('reports.detail.actions.close', 'Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Field list ----------

type FieldListProps = {
  fields: DatasetFieldRow[]
  hiddenPaths: string[]
  canEdit: boolean
  isDraggingChip: boolean
  onCollapse: () => void
  t: ReturnType<typeof useT>
}

function FieldList({ fields, hiddenPaths, canEdit, isDraggingChip, onCollapse, t }: FieldListProps) {
  const [query, setQuery] = React.useState('')
  const visibleFields = React.useMemo(
    () => filterFieldsByQuery(fields, query, (key, fallback) => t(key, fallback)),
    [fields, query, t],
  )
  return (
    <section className="space-y-2 rounded-md border border-border bg-card p-2" data-testid="reports-fields-sidebar">
      <div className="flex items-center justify-between gap-2 pl-1">
        <h2 className="text-overline text-muted-foreground">{t('reports.detail.sections.fields', 'Dataset fields')}</h2>
        <IconButton
          type="button"
          variant="ghost"
          size="xs"
          onClick={onCollapse}
          aria-label={t('reports.detail.fields.collapse', 'Hide fields')}
          aria-expanded
          data-testid="reports-fields-collapse"
        >
          <PanelLeftClose className="size-3.5" aria-hidden />
        </IconButton>
      </div>
      {fields.length > 0 ? (
        <SearchInput
          size="sm"
          value={query}
          onChange={setQuery}
          placeholder={t('reports.detail.fields.search', 'Search fields…')}
          aria-label={t('reports.detail.fields.search', 'Search fields…')}
          clearLabel={t('reports.detail.fields.searchClear', 'Clear field search')}
        />
      ) : null}
      {canEdit && fields.length > 0 ? (
        <p className="px-1 text-xs text-muted-foreground">
          {t('reports.detail.fields.dragHintZones', 'Drag a field into a zone. Drag a chip onto the remove strip to remove it.')}
        </p>
      ) : null}
      {canEdit ? <RemoveDropStrip active={isDraggingChip} t={t} /> : null}
      {fields.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">{t('reports.detail.fields.empty', 'No fields available for this dataset.')}</p>
      ) : visibleFields.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground" data-testid="reports-fields-no-match">
          {t('reports.detail.fields.noMatch', 'No fields match "{query}".', { query: query.trim() })}
        </p>
      ) : (
        <ul className="max-h-[70vh] space-y-0.5 overflow-y-auto pr-1">
          {visibleFields.map((field) => (
            <DraggableFieldRow key={field.key} field={field} canEdit={canEdit} t={t} />
          ))}
        </ul>
      )}
      {hiddenPaths.length > 0 ? (
        <p className="px-1 text-xs text-muted-foreground">
          {t('reports.detail.fields.hiddenCount', '{count} hidden by ACL').replace('{count}', String(hiddenPaths.length))}
        </p>
      ) : null}
    </section>
  )
}

/**
 * Explicit remove target (F14). It is a droppable only while a chip is being
 * dragged, so a sidebar field can never resolve to it.
 */
function RemoveDropStrip({ active, t }: { active: boolean; t: ReturnType<typeof useT> }) {
  const drop = useDroppable({ id: REMOVE_DROP_ID, disabled: !active })
  if (!active) return <div ref={drop.setNodeRef} className="hidden" aria-hidden />
  return (
    <div
      ref={drop.setNodeRef}
      data-testid="reports-remove-drop-strip"
      className={cn(
        'flex items-center justify-center gap-2 rounded-md border border-dashed px-3 py-3 text-xs font-medium transition-colors',
        drop.isOver
          ? 'border-status-error-border bg-status-error-bg text-status-error-text'
          : 'border-border bg-muted/40 text-muted-foreground',
      )}
    >
      <Trash2 className="size-3.5" aria-hidden />
      <span>
        {drop.isOver
          ? t('reports.detail.fields.dropToRemove', 'Drop here to remove from the zone.')
          : t('reports.detail.fields.removeStrip', 'Drag a chip here to remove it')}
      </span>
    </div>
  )
}

type DraggableFieldRowProps = {
  field: DatasetFieldRow
  canEdit: boolean
  t: ReturnType<typeof useT>
}

function DraggableFieldRow({ field, canEdit, t }: DraggableFieldRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `field:${field.key}`,
    disabled: !canEdit,
  })
  const label = t(field.labelKey, field.key)
  return (
    <li
      ref={setNodeRef}
      title={`${label} (${field.key})`}
      className={cn(
        'rounded-sm border border-transparent px-1.5 py-1 hover:border-border hover:bg-muted/50',
        canEdit ? 'cursor-grab touch-none active:cursor-grabbing' : '',
        isDragging ? 'opacity-50' : '',
      )}
      aria-label={t('reports.detail.fields.dragField', 'Drag {name} into a zone').replace('{name}', label)}
      {...(canEdit ? attributes : {})}
      {...(canEdit ? listeners : {})}
    >
      <div className="flex items-center gap-1.5">
        {canEdit ? <GripVertical className="size-3 shrink-0 text-muted-foreground" aria-hidden /> : null}
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{label}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{field.kind}</span>
      </div>
      <div className={cn('truncate font-mono text-xs text-muted-foreground', canEdit ? 'pl-4' : '')}>{field.key}</div>
    </li>
  )
}

function CollapsedFieldsRail({ onExpand, t }: { onExpand: () => void; t: ReturnType<typeof useT> }) {
  return (
    <div className="flex items-start lg:flex-col" data-testid="reports-fields-rail">
      <IconButton
        type="button"
        variant="outline"
        size="sm"
        onClick={onExpand}
        aria-label={t('reports.detail.fields.expand', 'Show fields')}
        aria-expanded={false}
        data-testid="reports-fields-expand"
      >
        <PanelLeftOpen className="size-4" aria-hidden />
      </IconButton>
    </div>
  )
}

// ---------- Type switcher ----------

type TypeSelectProps = {
  value: ReportType
  onChange: (next: ReportType) => void
  canEdit: boolean
  t: ReturnType<typeof useT>
}

const TYPE_OPTIONS: ReadonlyArray<ReportType> = REPORT_TYPES

function TypeSelect({ value, onChange, canEdit, t }: TypeSelectProps) {
  return (
    <label className="block space-y-1">
      <span className="text-overline text-muted-foreground">{t('reports.detail.sections.type', 'Report type')}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ReportType)}
        disabled={!canEdit}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
      >
        {TYPE_OPTIONS.map((option) => (
          <option key={option} value={option}>{t(`reports.list.types.${option}`, option)}</option>
        ))}
      </select>
    </label>
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

  const typeCanvas = (() => {
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
  })()

  return typeCanvas ?? null
}

// ---------- Editor tabs (Fields / Filters / Parameters) ----------

type EditorTabsCardProps = {
  definition: Definition
  parameters: ParameterDef[]
  fields: DatasetFieldRow[]
  canEdit: boolean
  onDefinitionChange: (next: Definition) => void
  onParametersChange: (next: ParameterDef[]) => void
  t: ReturnType<typeof useT>
}

function EditorTabsCard({
  definition,
  parameters,
  fields,
  canEdit,
  onDefinitionChange,
  onParametersChange,
  t,
}: EditorTabsCardProps) {
  const fieldByKey = React.useMemo(() => {
    const map = new Map<string, DatasetFieldRow>()
    for (const f of fields) map.set(f.key, f)
    return map
  }, [fields])

  const filterableFields = React.useMemo(
    () => fields.filter((f) => f.filterable !== false),
    [fields],
  )

  const filterCount = (definition.filters as FilterShape[] | undefined)?.length ?? 0
  const parameterCount = parameters.length

  return (
    <div className="flex min-w-0 flex-col rounded-md border border-border bg-card">
      <Tabs defaultValue="fields" className="flex flex-col">
        <div className="border-b border-border px-3 py-2">
          <TabsList>
            <TabsTrigger value="fields">{t('reports.detail.tabs.fields', 'Fields')}</TabsTrigger>
            <TabsTrigger value="filters">
              {t('reports.detail.tabs.filtersAndSorting', 'Filters & Sorting')}
              {filterCount > 0 ? (
                <span className="ml-2 rounded-full bg-muted px-1.5 text-xs font-medium">{filterCount}</span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="parameters">
              {t('reports.detail.tabs.parameters', 'Parameters')}
              {parameterCount > 0 ? (
                <span className="ml-2 rounded-full bg-muted px-1.5 text-xs font-medium">{parameterCount}</span>
              ) : null}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="fields" className="p-3">
          <PerTypeCanvas
            definition={definition}
            fields={fields}
            canEdit={canEdit}
            onChange={onDefinitionChange}
            t={t}
          />
        </TabsContent>
        <TabsContent value="filters" className="space-y-3 p-3">
          <FiltersSection
            filters={definition.filters as FilterShape[]}
            fields={filterableFields}
            fieldByKey={fieldByKey}
            canEdit={canEdit}
            onChange={(nextFilters) => onDefinitionChange({ ...definition, filters: nextFilters } as Definition)}
            t={t}
          />
          <div className="border-t border-border pt-3">
            <SortEditor
              definition={definition}
              fields={fields}
              fieldByKey={fieldByKey}
              canEdit={canEdit}
              onChange={onDefinitionChange}
              t={t}
            />
          </div>
        </TabsContent>
        <TabsContent value="parameters" className="p-3">
          <ParametersSection
            parameters={parameters}
            canEdit={canEdit}
            onChange={onParametersChange}
            t={t}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------- Common zone primitives ----------

type ZoneProps = {
  /** Stable, unique zone id used by the DnD drop-router (e.g. `groupBy`, `measures`, `rows`). */
  zoneId?: string
  title: string
  description?: string
  children: React.ReactNode
  emptyLabel?: string
  isEmpty?: boolean
}

function Zone({ zoneId, title, description, children, emptyLabel, isEmpty }: ZoneProps) {
  const drop = useDroppable({ id: zoneId ? `${ZONE_DROP_PREFIX}${zoneId}` : `${ZONE_DROP_PREFIX}__inert__`, disabled: !zoneId })
  return (
    <section
      ref={drop.setNodeRef}
      className={cn(
        'space-y-1.5 rounded-md border border-dashed border-border bg-card/60 px-3 py-2 transition-colors',
        drop.isOver ? 'border-primary bg-primary/5' : '',
      )}
      data-zone-id={zoneId}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      <div className="min-h-8 space-y-1">
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
  /**
   * When provided, the chip becomes draggable + sortable. Built by
   * `chipId(zoneId, key)` from the field key / measure alias, so it stays
   * stable across reorders. Drives reorder (chip → chip) and remove
   * (chip → remove strip).
   */
  dragId?: string
}

function Chip({ label, sublabel, onRemove, disabled, children, dragId }: ChipProps) {
  const t = useT()
  const dragLabel = t('reports.detail.chip.drag', 'Drag {name} to reorder', { name: label })
  const removeLabel = t('reports.detail.chip.remove', 'Remove {name}', { name: label })
  const sortable = useSortable({ id: dragId ?? '__chip_inert__', disabled: !dragId || disabled })
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable
  const handleStyle: React.CSSProperties | undefined = dragId
    ? { transform: CSS.Transform.toString(transform), transition }
    : undefined
  return (
    <div
      ref={dragId ? setNodeRef : undefined}
      style={handleStyle}
      className={cn(
        'flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-sm',
        isDragging ? 'opacity-50' : '',
      )}
    >
      {dragId ? (
        <span
          className={cn('flex shrink-0 items-center text-muted-foreground', disabled ? 'opacity-50' : 'cursor-grab active:cursor-grabbing')}
          {...(disabled ? {} : attributes)}
          {...(disabled ? {} : listeners)}
          aria-label={dragLabel}
        >
          <GripVertical className="size-3.5" aria-hidden />
        </span>
      ) : null}
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
          aria-label={removeLabel}
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

  const setFields = (next: string[]) => onChange({ ...definition, fields: next })

  return (
    <div className="space-y-3">
      <Zone
        zoneId="fields"
        title={t('reports.detail.zones.fields', 'Fields')}
        description={t('reports.detail.zones.fieldsHint', 'Columns to project from the dataset.')}
        isEmpty={definition.fields.length === 0}
        emptyLabel={t('reports.detail.zones.empty', 'Empty — add at least one field.')}
      >
        <SortableContext
          items={definition.fields.map((key) => chipId('fields', key))}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex flex-wrap items-center gap-2">
            {definition.fields.map((fieldKey) => {
              const field = fieldByKey.get(fieldKey)
              return (
                <Chip
                  key={fieldKey}
                  dragId={canEdit ? chipId('fields', fieldKey) : undefined}
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
        </SortableContext>
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
        zoneId="groupBy"
        title={t('reports.detail.zones.groupBy', 'Group by')}
        description={t('reports.detail.zones.groupByHint', 'Categorical fields that define one row per distinct combination.')}
        isEmpty={definition.groupBy.length === 0}
        emptyLabel={t('reports.detail.zones.empty', 'Empty — add at least one field.')}
      >
        <SortableContext
          items={definition.groupBy.map((key) => chipId('groupBy', key))}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex flex-wrap items-center gap-2">
            {definition.groupBy.map((key) => {
              const field = fieldByKey.get(key)
              return (
                <Chip
                  key={key}
                  dragId={canEdit ? chipId('groupBy', key) : undefined}
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
        </SortableContext>
      </Zone>

      <MeasureZone
        zoneId="measures"
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
  zoneId?: string
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
  zoneId,
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
  const chipKeys = React.useMemo(() => measureChipKeys(measures), [measures])

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

  const rows = measures.map((measure, idx) => {
    const field = fieldByKey.get(measure.field)
    const allowed = field ? fieldAllowedAggregations(field) : [...ALL_AGGREGATIONS]
    return (
      <SortableMeasureRow
        key={`${measure.field}-${idx}`}
        dragId={canEdit && zoneId ? chipId(zoneId, chipKeys[idx]) : undefined}
        label={measureLabel(measure, fieldByKey, t)}
        t={t}
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
          onChange={(e) => {
            const next = allowed.find((agg) => agg === e.target.value)
            if (next) updateMeasure(idx, { aggregation: next })
          }}
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
      </SortableMeasureRow>
    )
  })

  return (
    <Zone
      zoneId={zoneId}
      title={title}
      description={description}
      isEmpty={measures.length === 0}
      emptyLabel={t('reports.detail.zones.empty', 'Empty — add at least one field.')}
    >
      <div className="flex flex-col gap-2">
        {zoneId ? (
          <SortableContext items={chipKeys.map((key) => chipId(zoneId, key))} strategy={verticalListSortingStrategy}>
            {rows}
          </SortableContext>
        ) : rows}
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

function SortableMeasureRow({
  dragId,
  label,
  children,
  t,
}: {
  dragId?: string
  label: string
  children: React.ReactNode
  t: ReturnType<typeof useT>
}) {
  const sortable = useSortable({ id: dragId ?? '__measure_inert__', disabled: !dragId })
  const style: React.CSSProperties | undefined = dragId
    ? { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }
    : undefined
  return (
    <div
      ref={dragId ? sortable.setNodeRef : undefined}
      style={style}
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-2 py-1',
        sortable.isDragging ? 'opacity-50' : '',
      )}
    >
      {dragId ? (
        <span
          className="flex shrink-0 cursor-grab items-center text-muted-foreground active:cursor-grabbing"
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label={t('reports.detail.chip.drag', 'Drag {name} to reorder', { name: label })}
        >
          <GripVertical className="size-3.5" aria-hidden />
        </span>
      ) : null}
      {children}
    </div>
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
        zoneId="rows"
        title={t('reports.detail.zones.pivotRows', 'Rows')}
        description={t('reports.detail.zones.pivotRowsHint', 'Field(s) on the row axis. Cannot overlap with cols.')}
        isEmpty={definition.rows.length === 0}
        emptyLabel={t('reports.detail.zones.empty', 'Empty — add at least one field.')}
      >
        <SortableContext
          items={definition.rows.map((key) => chipId('rows', key))}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex flex-wrap items-center gap-2">
            {definition.rows.map((key) => {
              const field = fieldByKey.get(key)
              return (
                <Chip
                  key={key}
                  dragId={canEdit ? chipId('rows', key) : undefined}
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
        </SortableContext>
      </Zone>

      <Zone
        zoneId="cols"
        title={t('reports.detail.zones.pivotCols', 'Columns')}
        description={t('reports.detail.zones.pivotColsHint', 'Field(s) on the column axis. Cannot overlap with rows.')}
        isEmpty={definition.cols.length === 0}
        emptyLabel={t('reports.detail.zones.empty', 'Empty — add at least one field.')}
      >
        <SortableContext
          items={definition.cols.map((key) => chipId('cols', key))}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex flex-wrap items-center gap-2">
            {definition.cols.map((key) => {
              const field = fieldByKey.get(key)
              return (
                <Chip
                  key={key}
                  dragId={canEdit ? chipId('cols', key) : undefined}
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
        </SortableContext>
      </Zone>

      <MeasureZone
        zoneId="value"
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
      zoneId="measures"
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
  const measureOptions = React.useMemo(
    () => definition.measures.map((m) => ({ alias: measureAlias(m), label: measureLabel(m, fieldByKey, t) })),
    [definition.measures, fieldByKey, t],
  )
  const xCandidates = definition.groupBy.length > 0
    ? categoricalFields.filter((f) => groupBySet.has(f.key))
    : categoricalFields
  const yFieldsSet = React.useMemo(() => new Set(definition.chart.yFields), [definition.chart.yFields])
  const singleSeries = SINGLE_SERIES_CHART_KINDS.has(definition.chart.type)

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
          {singleSeries && measureOptions.length > 1 ? (
            <p className="text-xs text-muted-foreground">
              {t('reports.detail.chart.singleSeriesHint', 'This chart type plots one series — pick which measure to show.')}
            </p>
          ) : null}
          {measureOptions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('reports.detail.chart.yFieldsEmpty', 'Add at least one measure below; the chart will plot its alias.')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {measureOptions.map(({ alias, label }) => {
                const selected = yFieldsSet.has(alias)
                return (
                  <Button
                    key={alias}
                    type="button"
                    size="sm"
                    variant={selected ? 'default' : 'outline'}
                    title={alias}
                    onClick={() => updateChart({
                      yFields: singleSeries
                        ? [alias]
                        : selected
                          ? definition.chart.yFields.filter((y) => y !== alias)
                          : [...definition.chart.yFields, alias],
                    })}
                    disabled={!canEdit}
                  >
                    {label}
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
        zoneId="groupBy"
        title={t('reports.detail.zones.groupBy', 'Group by')}
        description={t('reports.detail.zones.chartGroupByHint', 'Optional: explicit groupBy for the underlying execution. Defaults to the X field.')}
      >
        <SortableContext
          items={definition.groupBy.map((key) => chipId('groupBy', key))}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex flex-wrap items-center gap-2">
            {definition.groupBy.map((key) => {
              const field = fieldByKey.get(key)
              return (
                <Chip
                  key={key}
                  dragId={canEdit ? chipId('groupBy', key) : undefined}
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
        </SortableContext>
      </Zone>

      <MeasureZone
        zoneId="measures"
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

// ---------- Filters ----------

const TEXT_LIKE_KINDS = new Set(['id', 'text', 'fk'])
const NUMERIC_FILTER_KINDS = new Set(['integer', 'float', 'money'])
const DATE_FILTER_KINDS = new Set(['date', 'datetime'])

/**
 * Normalise a dataset enum field's declared options into `{ value, label,
 * labelKey? }` triples. The DSL accepts three shapes per option — bare
 * string, bare number, or `{ value, labelKey? }`. Empty list when the
 * field has no inline options (e.g. when options live in a dictionary).
 */
function enumOptionList(field: DatasetFieldRow | undefined): Array<{ value: string; label: string; labelKey?: string }> {
  if (!field || field.kind !== 'enum') return []
  const raw = field.options
  if (!Array.isArray(raw)) return []
  return raw.map((opt) => {
    if (typeof opt === 'string' || typeof opt === 'number') {
      const v = String(opt)
      return { value: v, label: v }
    }
    const v = String(opt.value)
    return { value: v, label: v, labelKey: opt.labelKey }
  })
}

/**
 * Stable enum-order index for a value, used by the aggregator's enum-aware
 * comparator (item 4 from the builder polish round). Returns `Number.MAX_SAFE_INTEGER`
 * for values not in the option list so unknown values sort last.
 */
function enumOptionIndex(field: DatasetFieldRow | undefined, value: unknown): number {
  const opts = enumOptionList(field)
  if (!opts.length) return Number.MAX_SAFE_INTEGER
  const v = value == null ? '' : String(value)
  const idx = opts.findIndex((o) => o.value === v)
  return idx < 0 ? Number.MAX_SAFE_INTEGER : idx
}

const TEXT_OPS: FilterOp[] = ['contains', 'starts_with', 'ends_with', 'eq', 'ne', 'is_null', 'is_not_null']
const ENUM_OPS: FilterOp[] = ['eq', 'ne', 'in', 'nin', 'is_null', 'is_not_null']
const BOOL_OPS: FilterOp[] = ['eq', 'is_null', 'is_not_null']
const NUM_OPS: FilterOp[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null']
const DATE_OPS: FilterOp[] = ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null']
const FK_OPS: FilterOp[] = ['eq', 'ne', 'in', 'nin', 'is_null', 'is_not_null']

const DATE_RANGE_TOKENS: DateRangeToken[] = [
  'today', 'yesterday', 'last_24h', 'last_7_days', 'last_30_days',
  'mtd', 'last_month', 'qtd', 'last_quarter', 'ytd', 'last_year', 'custom',
]

function opsForField(field: DatasetFieldRow): FilterOp[] {
  if (field.kind === 'enum') return ENUM_OPS
  if (field.kind === 'boolean') return BOOL_OPS
  if (NUMERIC_FILTER_KINDS.has(field.kind)) return NUM_OPS
  if (DATE_FILTER_KINDS.has(field.kind)) return DATE_OPS
  if (field.kind === 'fk') return FK_OPS
  if (field.kind === 'custom_field') return TEXT_OPS // best-effort default
  return TEXT_OPS
}

function defaultOpForField(field: DatasetFieldRow): FilterOp {
  return opsForField(field)[0]
}

function defaultLiteralValue(field: DatasetFieldRow): unknown {
  if (field.kind === 'boolean') return false
  if (NUMERIC_FILTER_KINDS.has(field.kind)) return 0
  return ''
}

type FiltersSectionProps = {
  filters: FilterShape[]
  fields: DatasetFieldRow[]
  fieldByKey: Map<string, DatasetFieldRow>
  canEdit: boolean
  onChange: (next: FilterShape[]) => void
  t: ReturnType<typeof useT>
}

function FiltersSection({ filters, fields, fieldByKey, canEdit, onChange, t }: FiltersSectionProps) {
  const usedDateRangeFields = React.useMemo(
    () => new Set(filters.filter((f) => f.kind === 'date_range').map((f) => f.field)),
    [filters],
  )

  const addLiteral = (fieldKey: string) => {
    const field = fieldByKey.get(fieldKey)
    if (!field) return
    const op = defaultOpForField(field)
    const next: LiteralFilter = { kind: 'literal', field: fieldKey, op, value: defaultLiteralValue(field) }
    onChange([...filters, next])
  }

  const addDateRange = (fieldKey: string) => {
    const next: DateRangeFilter = { kind: 'date_range', field: fieldKey, token: 'last_30_days' }
    onChange([...filters, next])
  }

  const updateAt = (idx: number, patch: FilterShape) => {
    const next = filters.slice()
    next[idx] = patch
    onChange(next)
  }

  const removeAt = (idx: number) => {
    onChange(filters.filter((_, i) => i !== idx))
  }

  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-overline text-muted-foreground">{t('reports.detail.sections.filters', 'Filters')}</h2>
        <span className="text-xs text-muted-foreground">
          {filters.length > 0
            ? t('reports.detail.filters.count', '{count} active').replace('{count}', String(filters.length))
            : t('reports.detail.filters.none', 'No filters')}
        </span>
      </div>
      {filters.length === 0 ? (
        <p className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-3 py-3 text-center text-sm text-muted-foreground">
          {t('reports.detail.filters.emptyHint', 'Add a filter to narrow the report rows. AND semantics — every filter must match.')}
        </p>
      ) : (
        <div className="space-y-2">
          {filters.map((filter, idx) => (
            <FilterRow
              key={`${filter.kind}-${filter.field}-${idx}`}
              filter={filter}
              fields={fields}
              fieldByKey={fieldByKey}
              canEdit={canEdit}
              onChange={(next) => updateAt(idx, next)}
              onRemove={() => removeAt(idx)}
              t={t}
            />
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <FilterAddPicker
          fields={fields}
          excluded={new Set()}
          buttonLabel={t('reports.detail.filters.addLiteral', 'Add filter')}
          disabled={!canEdit}
          onPick={addLiteral}
          t={t}
        />
        <FilterAddPicker
          fields={fields.filter((f) => DATE_FILTER_KINDS.has(f.kind))}
          excluded={usedDateRangeFields}
          buttonLabel={t('reports.detail.filters.addDateRange', 'Add date range')}
          disabled={!canEdit}
          onPick={addDateRange}
          t={t}
        />
      </div>
    </section>
  )
}

type FilterAddPickerProps = {
  fields: DatasetFieldRow[]
  excluded: ReadonlySet<string>
  buttonLabel: string
  disabled?: boolean
  onPick: (fieldKey: string) => void
  t: ReturnType<typeof useT>
}

function FilterAddPicker({ fields, excluded, buttonLabel, disabled, onPick, t }: FilterAddPickerProps) {
  const [open, setOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!open) return
    function onDocClick(event: MouseEvent) {
      const node = containerRef.current
      if (node && event.target instanceof Node && !node.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const available = fields.filter((f) => !excluded.has(f.key))

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

type FilterRowProps = {
  filter: FilterShape
  fields: DatasetFieldRow[]
  fieldByKey: Map<string, DatasetFieldRow>
  canEdit: boolean
  onChange: (next: FilterShape) => void
  onRemove: () => void
  t: ReturnType<typeof useT>
}

function FilterRow({ filter, fields, fieldByKey, canEdit, onChange, onRemove, t }: FilterRowProps) {
  const field = fieldByKey.get(filter.field)

  if (filter.kind === 'date_range') {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
        <span className="text-xs font-medium uppercase text-muted-foreground">
          {t('reports.detail.filters.dateRangePrefix', 'Date range')}
        </span>
        <span className="font-medium">{field ? t(field.labelKey, field.key) : filter.field}</span>
        <span className="font-mono text-xs text-muted-foreground">{filter.field}</span>
        <select
          value={filter.token}
          onChange={(e) => onChange({ ...filter, token: e.target.value as DateRangeToken })}
          disabled={!canEdit}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          {DATE_RANGE_TOKENS.map((token) => (
            <option key={token} value={token}>
              {t(`reports.detail.filters.dateRangeToken.${token}`, token)}
            </option>
          ))}
        </select>
        {filter.token === 'custom' ? (
          <>
            <Input
              type="date"
              value={filter.from ?? ''}
              onChange={(e) => onChange({ ...filter, from: e.target.value || undefined })}
              disabled={!canEdit}
              className="h-8 w-44 text-xs"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <Input
              type="date"
              value={filter.to ?? ''}
              onChange={(e) => onChange({ ...filter, to: e.target.value || undefined })}
              disabled={!canEdit}
              className="h-8 w-44 text-xs"
            />
          </>
        ) : null}
        <button
          type="button"
          className="ml-auto rounded-sm p-1 hover:bg-muted disabled:opacity-50"
          onClick={() => canEdit && onRemove()}
          disabled={!canEdit}
          aria-label={t('reports.detail.filters.remove', 'Remove filter')}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    )
  }

  if (filter.kind === 'parameter') {
    // Parameters land in 3.3d. Read-only summary for now.
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
        <span className="text-xs font-medium uppercase text-muted-foreground">{t('reports.detail.filters.parameterPrefix', 'Parameter')}</span>
        <span className="font-medium">{field ? t(field.labelKey, field.key) : filter.field}</span>
        <span className="font-mono text-xs">{filter.op}</span>
        <span className="font-mono text-xs">@{filter.parameter}</span>
        <button
          type="button"
          className="ml-auto rounded-sm p-1 hover:bg-muted disabled:opacity-50"
          onClick={() => canEdit && onRemove()}
          disabled={!canEdit}
          aria-label={t('reports.detail.filters.remove', 'Remove filter')}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    )
  }

  // literal
  const ops = field ? opsForField(field) : TEXT_OPS
  const needsValue = !['is_null', 'is_not_null'].includes(filter.op)
  const isBetween = filter.op === 'between'
  const isInList = filter.op === 'in' || filter.op === 'nin'

  const valueComponent = needsValue
    ? renderLiteralValueInput({
        field,
        op: filter.op,
        value: filter.value,
        onChange: (next) => onChange({ ...filter, value: next }),
        canEdit,
        isBetween,
        isInList,
        t,
      })
    : null

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
      <span className="font-medium">{field ? t(field.labelKey, field.key) : filter.field}</span>
      <span className="font-mono text-xs text-muted-foreground">{filter.field}</span>
      <select
        value={filter.op}
        onChange={(e) => onChange({ ...filter, op: e.target.value as FilterOp })}
        disabled={!canEdit}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
      >
        {ops.map((op) => (
          <option key={op} value={op}>{t(`reports.detail.filters.op.${op}`, op)}</option>
        ))}
      </select>
      {valueComponent}
      <button
        type="button"
        className="ml-auto rounded-sm p-1 hover:bg-muted disabled:opacity-50"
        onClick={() => canEdit && onRemove()}
        disabled={!canEdit}
        aria-label={t('reports.detail.filters.remove', 'Remove filter')}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}

type RenderValueInputArgs = {
  field: DatasetFieldRow | undefined
  op: FilterOp
  value: unknown
  onChange: (next: unknown) => void
  canEdit: boolean
  isBetween: boolean
  isInList: boolean
  t: ReturnType<typeof useT>
}

function renderLiteralValueInput({ field, op, value, onChange, canEdit, isBetween, isInList, t }: RenderValueInputArgs): React.ReactNode {
  void op
  if (isBetween) {
    const tuple = (value && typeof value === 'object' && 'from' in (value as object))
      ? (value as { from?: unknown; to?: unknown })
      : { from: '', to: '' }
    return (
      <span className="flex items-center gap-1">
        <Input
          value={tuple.from == null ? '' : String(tuple.from)}
          onChange={(e) => onChange({ ...tuple, from: e.target.value })}
          disabled={!canEdit}
          placeholder={t('reports.detail.filters.from', 'from')}
          className="h-8 w-28 text-xs"
        />
        <span className="text-xs text-muted-foreground">→</span>
        <Input
          value={tuple.to == null ? '' : String(tuple.to)}
          onChange={(e) => onChange({ ...tuple, to: e.target.value })}
          disabled={!canEdit}
          placeholder={t('reports.detail.filters.to', 'to')}
          className="h-8 w-28 text-xs"
        />
      </span>
    )
  }

  if (isInList) {
    const text = Array.isArray(value) ? value.join(',') : (value == null ? '' : String(value))
    return (
      <Input
        value={text}
        onChange={(e) => {
          const parts = e.target.value.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
          onChange(parts)
        }}
        disabled={!canEdit}
        placeholder={t('reports.detail.filters.inListPlaceholder', 'value1, value2, …')}
        className="h-8 w-56 text-xs"
      />
    )
  }

  if (!field) {
    return (
      <Input
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        disabled={!canEdit}
        className="h-8 w-44 text-xs"
      />
    )
  }

  if (field.kind === 'boolean') {
    return (
      <select
        value={value === true ? 'true' : value === false ? 'false' : ''}
        onChange={(e) => onChange(e.target.value === 'true')}
        disabled={!canEdit}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
      >
        <option value="true">{t('reports.detail.filters.booleanTrue', 'true')}</option>
        <option value="false">{t('reports.detail.filters.booleanFalse', 'false')}</option>
      </select>
    )
  }

  if (NUMERIC_FILTER_KINDS.has(field.kind)) {
    return (
      <Input
        type="number"
        value={value == null ? '' : String(value)}
        onChange={(e) => {
          const raw = e.target.value
          if (raw.trim() === '') return onChange('')
          const num = Number(raw)
          if (Number.isFinite(num)) onChange(num)
        }}
        disabled={!canEdit}
        className="h-8 w-36 text-xs"
      />
    )
  }

  if (DATE_FILTER_KINDS.has(field.kind)) {
    return (
      <Input
        type={field.kind === 'datetime' ? 'datetime-local' : 'date'}
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        disabled={!canEdit}
        className="h-8 w-44 text-xs"
      />
    )
  }

  if (field.kind === 'enum') {
    // Render a dropdown when the dataset declared inline options. Free-text
    // fallback covers fields whose options live in a dictionary (still
    // resolved server-side at filter time) — those can't be enumerated here.
    const opts = enumOptionList(field)
    if (opts.length > 0) {
      const current = value == null ? '' : String(value)
      return (
        <select
          value={current}
          onChange={(e) => onChange(e.target.value)}
          disabled={!canEdit}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="">{t('reports.detail.filters.enumNoValue', '— pick a value —')}</option>
          {opts.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.labelKey ? t(opt.labelKey, opt.label) : opt.label}
            </option>
          ))}
        </select>
      )
    }
    return (
      <Input
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        disabled={!canEdit}
        placeholder={t('reports.detail.filters.enumPlaceholder', 'enum value')}
        className="h-8 w-44 text-xs"
      />
    )
  }

  // text-like and fk default to text input.
  return (
    <Input
      value={value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
      disabled={!canEdit}
      placeholder={TEXT_LIKE_KINDS.has(field.kind) ? t('reports.detail.filters.textPlaceholder', 'value') : t('reports.detail.filters.fkPlaceholder', 'fk id')}
      className="h-8 w-44 text-xs"
    />
  )
}

// ---------- Parameters ----------

const PARAMETER_KINDS: ParameterKind[] = ['string', 'number', 'boolean', 'date', 'date_range', 'fk', 'enum']
const PARAM_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/

type ParametersSectionProps = {
  parameters: ParameterDef[]
  canEdit: boolean
  onChange: (next: ParameterDef[]) => void
  t: ReturnType<typeof useT>
}

function ParametersSection({ parameters, canEdit, onChange, t }: ParametersSectionProps) {
  const updateAt = (idx: number, patch: Partial<ParameterDef>) => {
    const next = parameters.map((p, i) => (i === idx ? { ...p, ...patch } : p))
    onChange(next)
  }
  const removeAt = (idx: number) => onChange(parameters.filter((_, i) => i !== idx))
  const add = () => {
    const used = new Set(parameters.map((p) => p.key))
    let candidate = 'param1'
    let n = 1
    while (used.has(candidate)) {
      n += 1
      candidate = `param${n}`
    }
    onChange([...parameters, { key: candidate, kind: 'string', required: false }])
  }

  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-overline text-muted-foreground">{t('reports.detail.sections.parameters', 'Parameters')}</h2>
        <span className="text-xs text-muted-foreground">
          {parameters.length > 0
            ? t('reports.detail.parameters.count', '{count} declared').replace('{count}', String(parameters.length))
            : t('reports.detail.parameters.none', 'No parameters')}
        </span>
      </div>
      {parameters.length === 0 ? (
        <p className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-3 py-3 text-center text-sm text-muted-foreground">
          {t('reports.detail.parameters.emptyHint', 'Declare named parameters that bind to filters (e.g. companyId, dateRange).')}
        </p>
      ) : (
        <div className="space-y-2">
          {parameters.map((param, idx) => (
            <ParameterRow
              key={`${param.key}-${idx}`}
              param={param}
              canEdit={canEdit}
              keyError={validateParameterKey(param.key, parameters, idx, t)}
              onChange={(patch) => updateAt(idx, patch)}
              onRemove={() => removeAt(idx)}
              t={t}
            />
          ))}
        </div>
      )}
      <div className="pt-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={add}
          disabled={!canEdit}
        >
          <Plus className="size-3.5" aria-hidden />
          <span>{t('reports.detail.parameters.add', 'Add parameter')}</span>
        </Button>
      </div>
    </section>
  )
}

function validateParameterKey(
  key: string,
  all: ParameterDef[],
  selfIndex: number,
  t: ReturnType<typeof useT>,
): string | null {
  if (!key.trim()) return t('reports.detail.parameters.errorEmptyKey', 'Key is required')
  if (!PARAM_KEY_PATTERN.test(key)) return t('reports.detail.parameters.errorBadKey', 'Key must start with a letter or _ and contain only letters, digits, and _')
  for (let i = 0; i < all.length; i++) {
    if (i !== selfIndex && all[i].key === key) return t('reports.detail.parameters.errorDuplicateKey', 'Duplicate key')
  }
  return null
}

type ParameterRowProps = {
  param: ParameterDef
  canEdit: boolean
  keyError: string | null
  onChange: (patch: Partial<ParameterDef>) => void
  onRemove: () => void
  t: ReturnType<typeof useT>
}

function ParameterRow({ param, canEdit, keyError, onChange, onRemove, t }: ParameterRowProps) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.parameters.key', 'Key')}</span>
          <Input
            value={param.key}
            onChange={(e) => onChange({ key: e.target.value })}
            disabled={!canEdit}
            className={cn('h-8 w-44 text-sm font-mono', keyError ? 'border-status-error-border' : '')}
            aria-invalid={keyError ? 'true' : undefined}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.parameters.label', 'Label key')}</span>
          <Input
            value={param.labelKey ?? ''}
            onChange={(e) => onChange({ labelKey: e.target.value || undefined })}
            disabled={!canEdit}
            placeholder={t('reports.detail.parameters.labelPlaceholder', 'module.params.<key>.label')}
            className="h-8 w-64 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.parameters.kind', 'Kind')}</span>
          <select
            value={param.kind}
            onChange={(e) => onChange({ kind: e.target.value as ParameterKind })}
            disabled={!canEdit}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            {PARAMETER_KINDS.map((k) => (
              <option key={k} value={k}>{t(`reports.detail.parameters.kindLabel.${k}`, k)}</option>
            ))}
          </select>
        </label>
        <label className="mt-5 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(param.required)}
            onChange={(e) => onChange({ required: e.target.checked || undefined })}
            disabled={!canEdit}
          />
          {t('reports.detail.parameters.required', 'Required')}
        </label>
        <button
          type="button"
          className="ml-auto mt-5 rounded-sm p-1 hover:bg-muted disabled:opacity-50"
          onClick={() => canEdit && onRemove()}
          disabled={!canEdit}
          aria-label={t('reports.detail.parameters.remove', 'Remove parameter')}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      {keyError ? (
        <p className="text-xs text-status-error-text">{keyError}</p>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.parameters.defaultValue', 'Default value')}</span>
          {renderParameterDefaultInput(param, canEdit, (next) => onChange({ defaultValue: next }), t)}
        </label>
        {param.kind === 'fk' ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.parameters.relatedDatasetId', 'Related dataset id')}</span>
            <Input
              value={param.relatedDatasetId ?? ''}
              onChange={(e) => onChange({ relatedDatasetId: e.target.value || undefined })}
              disabled={!canEdit}
              placeholder={t('reports.detail.parameters.relatedDatasetIdPlaceholder', 'module.entity')}
              className="h-8 w-56 text-sm font-mono"
            />
          </label>
        ) : null}
        {param.kind === 'enum' ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.parameters.options', 'Options')}</span>
            <Input
              value={(param.options ?? []).join(',')}
              onChange={(e) => {
                const parts = e.target.value.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
                onChange({ options: parts.length > 0 ? parts : undefined })
              }}
              disabled={!canEdit}
              placeholder={t('reports.detail.parameters.optionsPlaceholder', 'opt1, opt2, …')}
              className="h-8 w-64 text-sm"
            />
          </label>
        ) : null}
      </div>
    </div>
  )
}

function renderParameterDefaultInput(
  param: ParameterDef,
  canEdit: boolean,
  onChange: (next: unknown) => void,
  t: ReturnType<typeof useT>,
): React.ReactNode {
  const value = param.defaultValue
  if (param.kind === 'boolean') {
    return (
      <select
        value={value === true ? 'true' : value === false ? 'false' : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}
        disabled={!canEdit}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="">{t('reports.detail.parameters.defaultValueNone', '— none —')}</option>
        <option value="true">{t('reports.detail.filters.booleanTrue', 'true')}</option>
        <option value="false">{t('reports.detail.filters.booleanFalse', 'false')}</option>
      </select>
    )
  }
  if (param.kind === 'number') {
    return (
      <Input
        type="number"
        value={value == null ? '' : String(value)}
        onChange={(e) => {
          const raw = e.target.value
          if (raw.trim() === '') return onChange(undefined)
          const num = Number(raw)
          if (Number.isFinite(num)) onChange(num)
        }}
        disabled={!canEdit}
        className="h-8 w-36 text-sm"
      />
    )
  }
  if (param.kind === 'date') {
    return (
      <Input
        type="date"
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value || undefined)}
        disabled={!canEdit}
        className="h-8 w-44 text-sm"
      />
    )
  }
  if (param.kind === 'date_range') {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        disabled={!canEdit}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="">{t('reports.detail.parameters.defaultValueNone', '— none —')}</option>
        {DATE_RANGE_TOKENS.map((token) => (
          <option key={token} value={token}>{t(`reports.detail.filters.dateRangeToken.${token}`, token)}</option>
        ))}
      </select>
    )
  }
  // string / enum / fk: free text
  return (
    <Input
      value={value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value || undefined)}
      disabled={!canEdit}
      className="h-8 w-56 text-sm"
    />
  )
}

// ---------- Preview ----------

type PreviewSectionProps = {
  definition: Definition
  runResult: ReportRunResponse | null
  previewError?: PreviewError | null
  isRunning: boolean
  viewMode: 'edit' | 'run'
  fieldByKey: Map<string, DatasetFieldRow>
  onColumnFormatChange?: (key: string, format: FieldFormat | undefined) => void
  t: ReturnType<typeof useT>
}

function previewIssueLabel(path: string, t: ReturnType<typeof useT>): string {
  const segments = path.split('.').filter((segment) => segment !== 'definition')
  if (segments.length === 0) return ''
  return t(`reports.detail.preview.issuePath.${segments.join('.')}`, segments.join(' › '))
}

function PreviewErrorPanel({ error, t }: { error: PreviewError; t: ReturnType<typeof useT> }) {
  return (
    <Alert status="error" size="sm" className="mt-2" data-testid="reports-preview-error">
      <AlertDescription>
        <p className="font-medium">{t('reports.detail.preview.invalid', 'The preview could not run:')}</p>
        {error.issues.length > 0 ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {error.issues.map((issue, idx) => {
              const label = previewIssueLabel(issue.path, t)
              return (
                <li key={`${issue.path}-${idx}`}>
                  {label ? <span className="font-medium">{label}: </span> : null}
                  {issue.message}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-1">{error.message}</p>
        )}
      </AlertDescription>
    </Alert>
  )
}

function PreviewSection({
  definition,
  runResult,
  previewError,
  isRunning,
  viewMode,
  fieldByKey,
  onColumnFormatChange,
  t,
}: PreviewSectionProps) {
  const renderedRows = Array.isArray(runResult?.rows) ? runResult!.rows! : []
  const renderedColumns = runResult?.meta?.fields && runResult.meta.fields.length
    ? runResult.meta.fields
    : (renderedRows[0] ? Object.keys(renderedRows[0]) : [])
  const columns = runResult?.meta?.columns
  const mixedCurrencyColumns = runResult?.meta?.mixedCurrencyColumns
  const seriesLabels = React.useMemo(() => buildSeriesLabels(definition, fieldByKey, t), [definition, fieldByKey, t])

  // Run mode expands the section to fill the viewport so the result table /
  // chart is the focal element. Edit mode keeps a smaller minimum height so
  // the editor above stays in view.
  const sectionClass = viewMode === 'run'
    ? 'rounded-md border border-border bg-card p-4 min-h-[70vh]'
    : 'rounded-md border border-border bg-card p-4 min-h-[40vh]'
  const headingLabel = viewMode === 'run'
    ? t('reports.detail.sections.result', 'Result')
    : t('reports.detail.sections.previewLive', 'Live preview (10 rows)')
  const waitingLabel = t(
    viewMode === 'edit' ? 'reports.detail.preview.previewWaiting' : 'reports.detail.preview.notRun',
    viewMode === 'edit' ? 'Add at least one field — preview will appear here.' : 'Click "Run" to execute this report.',
  )
  const errorPanel = previewError ? <PreviewErrorPanel error={previewError} t={t} /> : null

  if (definition.type === 'chart') {
    const mixedSeries = (mixedCurrencyColumns ?? []).filter((key) => definition.chart.yFields.includes(key))
    return (
      <section className={sectionClass}>
        <h2 className="text-overline text-muted-foreground">{headingLabel}</h2>
        {errorPanel}
        {mixedSeries.length > 0 ? (
          <p className="mt-2 text-xs text-status-warning-text">
            {t('reports.format.mixedCurrency', 'Mixed currencies — not summed across currencies')}
            {': '}
            {mixedSeries.map((key) => seriesLabels[key] ?? key).join(', ')}
          </p>
        ) : null}
        {renderedRows.length === 0 && !isRunning ? (
          previewError ? null : (
            <p className="mt-2 text-sm text-muted-foreground">
              {runResult ? t('reports.detail.preview.empty', 'The report returned no rows.') : waitingLabel}
            </p>
          )
        ) : (
          <div className="mt-3">
            <ReportChart
              spec={definition.chart}
              rows={renderedRows}
              loading={isRunning}
              columns={columns}
              columnFormats={definition.columnFormats}
              seriesLabels={seriesLabels}
            />
          </div>
        )}
      </section>
    )
  }

  return (
    <section className={sectionClass}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-overline text-muted-foreground">{headingLabel}</h2>
        <span className="text-xs text-muted-foreground">
          {runResult?.total != null
            ? t('reports.detail.preview.rowCount', '{count} rows').replace('{count}', String(runResult.total))
            : previewError ? null : waitingLabel}
        </span>
      </div>
      {errorPanel}
      {isRunning ? (
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
      ) : renderedRows.length === 0 ? (
        previewError ? null : (
          <p className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
            {runResult ? t('reports.detail.preview.empty', 'The report returned no rows.') : waitingLabel}
          </p>
        )
      ) : (
        <ResultTable
          rows={renderedRows}
          columnKeys={renderedColumns}
          columns={columns}
          mixedCurrencyColumns={mixedCurrencyColumns}
          definition={definition}
          fieldByKey={fieldByKey}
          canEditFormats={viewMode === 'edit' && !!onColumnFormatChange}
          onColumnFormatChange={onColumnFormatChange}
          t={t}
        />
      )}
    </section>
  )
}
