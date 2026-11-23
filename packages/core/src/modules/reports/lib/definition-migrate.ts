import {
  effectiveChartGroupBy,
  measureAlias,
  type ChartKind,
  type ChartSpec,
  type ColumnFormats,
  type DateRangeToken,
  type FilterOp,
  type MeasureExpr,
  type ReportType,
  type Sort,
} from '@open-mercato/shared/modules/reports/dsl'
import { limitChartYFields, resolveChartXField, syncChartYFields } from './chart-spec'

/**
 * Builder-side report definition shapes. They mirror `ReportDefinition` from
 * the shared DSL with two editor affordances: a pivot `value` may be `null`
 * while the user is still picking it, and a chart always carries explicit
 * `groupBy` / `measures` arrays.
 */
export type BuilderLiteralFilter = { kind: 'literal'; field: string; op: FilterOp; value?: unknown }
export type BuilderParameterFilter = { kind: 'parameter'; field: string; op: FilterOp; parameter: string }
export type BuilderDateRangeFilter = { kind: 'date_range'; field: string; token: DateRangeToken; from?: string; to?: string }
export type BuilderFilter = BuilderLiteralFilter | BuilderParameterFilter | BuilderDateRangeFilter

export type BuilderChartSpec = Pick<ChartSpec, 'type' | 'xField' | 'yFields' | 'stacked' | 'showLegend'>

type BuilderCommon = { filters: BuilderFilter[]; columnFormats?: ColumnFormats }

export type FlatListDefinition = BuilderCommon & { type: 'flat_list'; fields: string[]; sort: Sort[]; limit?: number }
export type GroupedDefinition = BuilderCommon & {
  type: 'grouped'
  fields: string[]
  groupBy: string[]
  measures: MeasureExpr[]
  sort: Sort[]
  limit?: number
}
export type PivotDefinition = BuilderCommon & { type: 'pivot'; rows: string[]; cols: string[]; value: MeasureExpr | null }
export type ChartDefinition = BuilderCommon & {
  type: 'chart'
  chart: BuilderChartSpec
  groupBy: string[]
  measures: MeasureExpr[]
  limit?: number
}
export type SummaryDefinition = BuilderCommon & { type: 'summary'; measures: MeasureExpr[] }

export type BuilderDefinition =
  | FlatListDefinition
  | GroupedDefinition
  | PivotDefinition
  | ChartDefinition
  | SummaryDefinition

export const REPORT_TYPES: readonly ReportType[] = ['flat_list', 'grouped', 'pivot', 'chart', 'summary']

/** Chart kinds that plot exactly one Y series (the server validator enforces it). */
export const SINGLE_SERIES_CHART_KINDS: ReadonlySet<ChartKind> = new Set<ChartKind>(['pie', 'donut', 'scatter'])

export function defaultDefinition(type: ReportType): BuilderDefinition {
  switch (type) {
    case 'flat_list':
      return { type, fields: [], filters: [], sort: [] }
    case 'grouped':
      return { type, fields: [], groupBy: [], measures: [], filters: [], sort: [] }
    case 'pivot':
      return { type, rows: [], cols: [], value: null, filters: [] }
    case 'chart':
      return { type, chart: { type: 'bar', xField: '', yFields: [] }, filters: [], groupBy: [], measures: [] }
    case 'summary':
      return { type, measures: [], filters: [] }
  }
}

/** What a type switch could not carry into the target type. */
export type DroppedSlot = 'fields' | 'groupBy' | 'cols' | 'measures' | 'sort' | 'limit' | 'chart'

export type DroppedItem =
  | { slot: 'fields' | 'groupBy' | 'cols' | 'sort'; field: string }
  | { slot: 'measures'; field: string; aggregation: MeasureExpr['aggregation']; alias: string }
  | { slot: 'limit'; value: number }
  | { slot: 'chart'; chartType: ChartKind }

export type MigrationResult = { definition: BuilderDefinition; dropped: DroppedItem[] }

type Slots = {
  fields: string[]
  dims: string[]
  cols: string[]
  measures: MeasureExpr[]
  sort: Sort[]
  limit?: number
  chart?: BuilderChartSpec
}

function uniq(values: readonly string[]): string[] {
  const out: string[] = []
  for (const value of values) if (value && !out.includes(value)) out.push(value)
  return out
}

function extractSlots(def: BuilderDefinition): Slots {
  switch (def.type) {
    case 'flat_list':
      return { fields: [...def.fields], dims: [], cols: [], measures: [], sort: [...def.sort], limit: def.limit }
    case 'grouped':
      return {
        fields: [...def.fields],
        dims: [...def.groupBy],
        cols: [],
        measures: [...def.measures],
        sort: [...def.sort],
        limit: def.limit,
      }
    case 'pivot':
      return { fields: [], dims: [...def.rows], cols: [...def.cols], measures: def.value && def.value.field ? [def.value] : [], sort: [] }
    case 'chart':
      return {
        fields: [],
        dims: effectiveChartGroupBy(def),
        cols: [],
        measures: [...def.measures],
        sort: [],
        limit: def.limit,
        chart: def.chart,
      }
    case 'summary':
      return { fields: [], dims: [], cols: [], measures: [...def.measures], sort: [] }
  }
}

function dropFields(slot: 'fields' | 'groupBy' | 'cols', fields: readonly string[]): DroppedItem[] {
  return fields.map((field) => ({ slot, field }))
}

function dropMeasures(measures: readonly MeasureExpr[]): DroppedItem[] {
  return measures.map((m) => ({ slot: 'measures', field: m.field, aggregation: m.aggregation, alias: measureAlias(m) }))
}

function keepSort(sort: readonly Sort[], available: ReadonlySet<string>): { kept: Sort[]; dropped: DroppedItem[] } {
  const kept: Sort[] = []
  const dropped: DroppedItem[] = []
  for (const entry of sort) {
    if (available.has(entry.field)) kept.push({ ...entry })
    else dropped.push({ slot: 'sort', field: entry.field })
  }
  return { kept, dropped }
}

function chartYFieldsFor(chartType: ChartKind, measures: readonly MeasureExpr[]): string[] {
  const aliases = measures.map((m) => measureAlias(m))
  return SINGLE_SERIES_CHART_KINDS.has(chartType) ? aliases.slice(0, 1) : aliases
}

/**
 * Map a definition onto another report type, keeping every slot the target
 * can represent:
 *
 * - `fields` ↔ `fields` (flat list / grouped); a flat list also absorbs the
 *   group keys and pivot axes as plain columns.
 * - `groupBy` ↔ pivot `rows` ↔ chart `groupBy` (an implicit chart X field
 *   counts as its group key).
 * - `measures` ↔ pivot `value` (first measure) ↔ chart `measures`/`yFields`.
 * - `filters` and `columnFormats` always carry over.
 * - `sort` survives only when its field still exists in the target.
 *
 * Anything the target cannot represent is listed in `dropped`.
 */
export function migrateDefinition(prev: BuilderDefinition, nextType: ReportType): MigrationResult {
  if (prev.type === nextType) return { definition: prev, dropped: [] }
  const slots = extractSlots(prev)
  const common: BuilderCommon = {
    filters: prev.filters.map((filter) => ({ ...filter })),
    ...(prev.columnFormats ? { columnFormats: { ...prev.columnFormats } } : {}),
  }
  const dropped: DroppedItem[] = []
  if (slots.chart && nextType !== 'chart' && slots.chart.xField) {
    dropped.push({ slot: 'chart', chartType: slots.chart.type })
  }

  switch (nextType) {
    case 'flat_list': {
      const fields = uniq([...slots.fields, ...slots.dims, ...slots.cols])
      dropped.push(...dropMeasures(slots.measures))
      const sort = keepSort(slots.sort, new Set(fields))
      dropped.push(...sort.dropped)
      return {
        definition: {
          type: 'flat_list',
          fields,
          sort: sort.kept,
          ...common,
          ...(slots.limit ? { limit: slots.limit } : {}),
        },
        dropped,
      }
    }
    case 'grouped': {
      const groupBy = uniq([...slots.dims, ...slots.cols])
      const fields = uniq(slots.fields)
      const measures = slots.measures.map((m) => ({ ...m }))
      const available = new Set([...fields, ...groupBy, ...measures.map((m) => measureAlias(m))])
      const sort = keepSort(slots.sort, available)
      dropped.push(...sort.dropped)
      return {
        definition: {
          type: 'grouped',
          fields,
          groupBy,
          measures,
          sort: sort.kept,
          ...common,
          ...(slots.limit ? { limit: slots.limit } : {}),
        },
        dropped,
      }
    }
    case 'pivot': {
      const cols = uniq(slots.cols)
      const rows = uniq(slots.dims).filter((key) => !cols.includes(key))
      dropped.push(...dropFields('fields', slots.fields.filter((key) => !rows.includes(key) && !cols.includes(key))))
      const [value, ...rest] = slots.measures
      dropped.push(...dropMeasures(rest))
      dropped.push(...slots.sort.map((entry): DroppedItem => ({ slot: 'sort', field: entry.field })))
      if (slots.limit) dropped.push({ slot: 'limit', value: slots.limit })
      return {
        definition: { type: 'pivot', rows, cols, value: value ? { ...value } : null, ...common },
        dropped,
      }
    }
    case 'chart': {
      const groupBy = uniq([...slots.dims, ...slots.cols])
      const measures = slots.measures.map((m) => ({ ...m }))
      dropped.push(...dropFields('fields', slots.fields.filter((key) => !groupBy.includes(key))))
      dropped.push(...slots.sort.map((entry): DroppedItem => ({ slot: 'sort', field: entry.field })))
      const chartType: ChartKind = 'bar'
      return {
        definition: {
          type: 'chart',
          chart: { type: chartType, xField: groupBy[0] ?? '', yFields: chartYFieldsFor(chartType, measures) },
          groupBy,
          measures,
          ...common,
          ...(slots.limit ? { limit: slots.limit } : {}),
        },
        dropped,
      }
    }
    case 'summary': {
      dropped.push(...dropFields('fields', slots.fields))
      dropped.push(...dropFields('groupBy', slots.dims))
      dropped.push(...dropFields('cols', slots.cols))
      dropped.push(...slots.sort.map((entry): DroppedItem => ({ slot: 'sort', field: entry.field })))
      if (slots.limit) dropped.push({ slot: 'limit', value: slots.limit })
      return {
        definition: { type: 'summary', measures: slots.measures.map((m) => ({ ...m })), ...common },
        dropped,
      }
    }
  }
}

/**
 * Per-type session draft stash. When the user leaves type A, its exact
 * definition is stored together with the edit revision at that moment. Coming
 * back to A with no edits made in between restores A exactly; any edit in the
 * meantime invalidates the stash and the slots are migrated from the current
 * definition instead.
 */
export type DraftStash = Partial<Record<ReportType, { definition: BuilderDefinition; revision: number }>>

export type TypeSwitchResult = MigrationResult & { stash: DraftStash; restored: boolean }

export function switchDefinitionType(
  current: BuilderDefinition,
  nextType: ReportType,
  stash: DraftStash,
  revision: number,
): TypeSwitchResult {
  if (current.type === nextType) return { definition: current, dropped: [], stash, restored: false }
  const nextStash: DraftStash = { ...stash, [current.type]: { definition: current, revision } }
  const saved = stash[nextType]
  if (saved && saved.revision === revision) {
    return { definition: saved.definition, dropped: [], stash: nextStash, restored: true }
  }
  return { ...migrateDefinition(current, nextType), stash: nextStash, restored: false }
}

/**
 * Keep a chart definition valid after an edit (F13): measure additions and
 * removals flow into `chart.yFields` (single-series kinds keep one), and an
 * X field that is no longer a group key falls back to the first one.
 * Non-chart definitions pass through unchanged.
 */
export function reconcileChartDefinition(prev: BuilderDefinition, next: BuilderDefinition): BuilderDefinition {
  if (next.type !== 'chart') return next
  const prevMeasures = prev.type === 'chart' ? prev.measures : next.measures
  const aliases = next.measures.map((m) => measureAlias(m))
  const yFields = prevMeasures === next.measures
    ? limitChartYFields(next.chart.type, next.chart.yFields, aliases)
    : syncChartYFields(next.chart, prevMeasures, next.measures)
  const xField = resolveChartXField(next.chart.xField, next.groupBy)
  const unchanged = xField === next.chart.xField
    && yFields.length === next.chart.yFields.length
    && yFields.every((y, idx) => y === next.chart.yFields[idx])
  if (unchanged) return next
  return { ...next, chart: { ...next.chart, xField, yFields } }
}
