import {
  effectiveChartGroupBy,
  type Dataset,
  type FilterExpr,
  type ParameterDef,
  type ReportColumnDescriptor,
  type ReportDefinition,
  type Sort as DslSort,
} from '@open-mercato/shared/modules/reports/dsl'
import type { QueryEngine, QueryOptions } from '@open-mercato/shared/lib/query/types'
import { buildColumnDescriptors, definitionMeasures, describeField } from './columns'
import { createProfiler, shouldEnableProfiler, type Profiler } from '@open-mercato/shared/lib/profiler'
import { bindFiltersToParameters, resolveParameters } from './parameters'
import { validateDefinitionAgainstAcl } from './field-redact'
import { translateFlatList } from './query-translator'
import {
  aggregateGroupBy,
  aggregatePivot,
  aggregateSummary,
  measureAlias,
  pivotToWideRows,
  readFieldValue,
  type MeasureExpr,
  type Row,
} from './aggregator'

function createReportsProfiler(definition: ReportDefinition, dataset: Dataset): Profiler {
  const target = `${definition.type}:${dataset.id}`
  const enabled = shouldEnableProfiler(target) || shouldEnableProfiler(`reports.${definition.type}`)
  return createProfiler({
    scope: 'reports',
    target,
    label: `reports:${target}`,
    loggerLabel: '[reports:profile]',
    enabled,
  })
}

export type ExecutionInput = {
  dataset: Dataset
  definition: ReportDefinition
  /** The features of the **running** user, not the report owner. */
  userFeatures: ReadonlySet<string>
  tenantId: string
  organizationId: string
  /** Raw parameter values from the request body / URL / schedule frozen state. */
  params?: Record<string, unknown>
  /** Parameter declarations from the report (preferred) or dataset.parameters fallback. */
  parameterDefs?: ParameterDef[]
  /** Optional sync row cap. Defaults to OM_REPORTS_INMEMORY_CAP env (25 000). */
  inMemoryCap?: number
  /** Pin the clock when resolving relative date-range tokens. */
  now?: Date
  /**
   * Running user id. Forwarded with `userFeatures` to the QueryEngine so the
   * row-level RBAC layer (sync `*.querying` subscribers, query enrichers)
   * applies to report reads exactly like it does to CRUD list reads.
   */
  userId?: string
  /** Flat-list page (1-based). Aggregated reports always read every page up to the cap. */
  page?: number
  /**
   * Flat-list only: read every page up to the cap instead of one page.
   * Used by exports, schedules and async runs, which must deliver the full
   * result set, not the first screen.
   */
  readAllPages?: boolean
}

export type ExecutionResult = {
  mode: 'sync'
  rows: Record<string, unknown>[]
  total: number
  meta: {
    duration_ms: number
    truncated: boolean
    cap: number
    /** Field list the caller can use to drive a header row (aggregated reports only). */
    fields?: string[]
    /** One descriptor per output column (kind, currency, format) — drives display formatting. */
    columns?: ReportColumnDescriptor[]
    /** Money measure columns aggregated over rows with more than one currency. */
    mixedCurrencyColumns?: string[]
    /** Raw rows read before aggregation (aggregated reports only). */
    scannedRows?: number
  }
}

export type AsyncDispatch = {
  mode: 'async'
  reason: 'over_cap' | 'requested'
  estimatedRows: number
  cap: number
}

/** Row cap for async runs (`OM_REPORTS_ASYNC_CAP`, default 100 000). */
export function readAsyncCap(): number {
  const raw = process.env.OM_REPORTS_ASYNC_CAP
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 100_000
}

export function readEnvCap(): number {
  const raw = process.env.OM_REPORTS_INMEMORY_CAP
  if (!raw) return 25_000
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 25_000
}

/**
 * Execute a report definition synchronously over the QueryEngine.
 *
 * Enforcement order matches the spec's three-point ACL contract:
 *   1. validate the definition against the **running** user's features
 *      (never the owner's)
 *   2. resolve + bind parameters
 *   3. translate to QueryOptions and pin tenant/org scopes
 *   4. run; if the result is at the cap we mark it truncated so the
 *      caller can offer async re-dispatch
 */
export async function executeFlatList(
  queryEngine: QueryEngine,
  input: ExecutionInput,
): Promise<ExecutionResult> {
  if (input.definition.type !== 'flat_list') {
    throw new Error(`executeFlatList only supports flat_list (got '${input.definition.type}')`)
  }
  const flatDefinition = input.definition
  const profiler = createReportsProfiler(input.definition, input.dataset)
  try {
    // Step 1: field-ACL — re-resolved against the running user.
    await profiler.measure('field-acl', () => {
      validateDefinitionAgainstAcl(input.definition, input.dataset, input.userFeatures)
    })

    // Step 2: parameter resolution + filter binding.
    const now = input.now ?? new Date()
    const boundFilters = await profiler.measure('parameters', () => {
      const resolved = resolveParameters(input.params, input.parameterDefs, now)
      return bindFiltersToParameters(input.definition.filters, resolved, now)
    })

    // Step 3: query translation.
    const cap = Math.max(1, input.inMemoryCap ?? readEnvCap())
    const opts = await profiler.measure('translate', () =>
      translateFlatList(input.definition, input.dataset, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        filters: boundFilters,
        pageSize: Math.min(cap, 100),
        page: Math.max(1, input.page ?? 1),
        rbac: { userId: input.userId, userFeatures: [...input.userFeatures] },
      }),
    )

    // Step 4: run + measure.
    const started = Date.now()
    let rows: Record<string, unknown>[]
    let total: number
    if (input.readAllPages) {
      const read = await profiler.measure('query.execute', () =>
        readPagesUntilCap(
          queryEngine,
          input.dataset.entityType,
          opts,
          typeof flatDefinition.limit === 'number' ? Math.min(cap, flatDefinition.limit) : cap,
        ),
      )
      rows = read.rows
      total = read.total ?? rows.length
    } else {
      const result = await profiler.measure('query.execute', () =>
        queryEngine.query(input.dataset.entityType, opts),
      )
      rows = result.items as Record<string, unknown>[]
      total = typeof result.total === 'number' ? result.total : rows.length
    }
    const duration_ms = Date.now() - started
    const truncated = input.readAllPages
      ? total > rows.length && (typeof flatDefinition.limit !== 'number' || rows.length < flatDefinition.limit)
      : total > cap

    profiler.end({ rows: rows.length, total, truncated, cap })
    return {
      mode: 'sync',
      rows,
      total,
      meta: {
        duration_ms,
        truncated,
        cap,
        columns: input.definition.fields.map((key) => {
          const descriptor = describeField(input.dataset, key)
          const override = input.definition.columnFormats?.[key]
          return override ? { ...descriptor, format: { ...(descriptor.format ?? {}), ...override } } : descriptor
        }),
      },
    }
  } catch (err) {
    profiler.end({ error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

/**
 * Decide if a definition should be dispatched to the async worker before any
 * query is issued. Phase 1 uses a simple heuristic: if the caller explicitly
 * requested async mode, or the dataset declares an estimated row count
 * exceeding the in-memory cap, switch to async. The full cap is then
 * authoritative; the async worker streams results into the attachments
 * module.
 */
export function shouldDispatchAsync(
  estimatedRows: number,
  requested: 'sync' | 'async' | undefined,
  cap: number = readEnvCap(),
): AsyncDispatch | null {
  if (requested === 'async') return { mode: 'async', reason: 'requested', estimatedRows, cap }
  if (estimatedRows > cap) return { mode: 'async', reason: 'over_cap', estimatedRows, cap }
  return null
}

/**
 * Row-count probe used before a sync run: a `pageSize: 1` query whose
 * `total` tells us whether the report would scan more than the in-memory
 * cap. Same filters, scope and RBAC context as the real run.
 */
export async function estimateReportRows(queryEngine: QueryEngine, input: ExecutionInput): Promise<number> {
  validateDefinitionAgainstAcl(input.definition, input.dataset, input.userFeatures)
  const now = input.now ?? new Date()
  const resolved = resolveParameters(input.params, input.parameterDefs, now)
  const boundFilters = bindFiltersToParameters(input.definition.filters, resolved, now)
  const ctx = {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    filters: boundFilters,
    pageSize: 1,
    page: 1,
    rbac: { userId: input.userId, userFeatures: [...input.userFeatures] },
  }
  const opts =
    input.definition.type === 'flat_list'
      ? translateFlatList(input.definition, input.dataset, ctx)
      : buildAggregationQueryOptions(input.definition, input.dataset, { ...ctx, cap: 1 })
  const probe = await queryEngine.query(input.dataset.entityType, { ...opts, page: { page: 1, pageSize: 1 } })
  if (typeof probe.total === 'number') return probe.total
  return probe.items.length
}

/**
 * Read every page (`pageSize ≤ 100`, the platform cap) until `cap` rows are
 * collected or the result set is exhausted. Returns the rows plus the
 * engine-reported total so the caller can flag truncation.
 */
async function readPagesUntilCap(
  queryEngine: QueryEngine,
  entityType: Dataset['entityType'],
  baseOpts: QueryOptions,
  cap: number,
): Promise<{ rows: Row[]; total: number | null }> {
  const pageSize = Math.min(100, Math.max(1, cap))
  const rows: Row[] = []
  let total: number | null = null
  for (let page = 1; rows.length < cap; page += 1) {
    const result = await queryEngine.query(entityType, { ...baseOpts, page: { page, pageSize } })
    const items = result.items as Row[]
    if (typeof result.total === 'number') total = result.total
    for (const item of items) {
      if (rows.length >= cap) break
      rows.push(item)
    }
    if (items.length < pageSize) break
    if (total !== null && page * pageSize >= total) break
  }
  return { rows, total }
}

// ============================================================================
// Aggregated execution paths (grouped / pivot / chart / summary)
// ============================================================================

/**
 * Collect the **dataset** field paths referenced by the definition — the
 * projection list the QueryEngine should fetch before aggregation.
 *
 * Measure aliases, sort keys that point at aggregated aliases, and chart
 * `yFields` (which are measure aliases) are deliberately excluded; only
 * raw dataset fields end up in the projection.
 */
function collectReferencedFields(definition: ReportDefinition): string[] {
  const set = new Set<string>()
  const add = (key: string | undefined | null) => {
    if (typeof key === 'string' && key.length > 0) set.add(key)
  }
  const walkFilters = (filters: FilterExpr[] | undefined) => {
    if (!filters?.length) return
    for (const f of filters) {
      if (f.kind === 'group') walkFilters(f.children)
      else add(f.field)
    }
  }
  switch (definition.type) {
    case 'flat_list':
      for (const f of definition.fields ?? []) add(f)
      walkFilters(definition.filters)
      for (const s of definition.sort ?? []) add(s.field)
      break
    case 'grouped':
      for (const g of definition.groupBy ?? []) add(g)
      for (const m of definition.measures ?? []) add(m.field)
      walkFilters(definition.filters)
      // sort can reference either a groupBy key (already added) or a
      // measure alias (post-aggregation, not a dataset field) — skip sort.
      break
    case 'pivot':
      for (const r of definition.rows ?? []) add(r)
      for (const c of definition.cols ?? []) add(c)
      if (definition.value) add(definition.value.field)
      walkFilters(definition.filters)
      break
    case 'chart':
      add(definition.chart?.xField)
      // yFields are measure aliases, not dataset fields — exclude.
      for (const g of effectiveChartGroupBy(definition)) add(g)
      for (const m of definition.measures ?? []) add(m.field)
      walkFilters(definition.filters)
      break
    case 'summary':
      for (const m of definition.measures ?? []) add(m.field)
      walkFilters(definition.filters)
      break
  }
  return Array.from(set)
}

function moneyCurrencyFields(definition: ReportDefinition, dataset: Dataset): string[] {
  const out = new Set<string>()
  for (const measure of definitionMeasures(definition)) {
    const field = dataset.fields.find((f) => f.key === measure.field)
    if (field?.kind === 'money' && field.currencyField) out.add(field.currencyField)
  }
  return Array.from(out)
}

/**
 * Money measures must never silently sum across currencies. When a money
 * measure's rows carry more than one currency and the currency column is
 * not one of the group keys, the column is reported in
 * `meta.mixedCurrencyColumns` and its descriptor drops the currency so it
 * renders as a plain number. When the rows share one currency the
 * descriptor carries that code.
 */
function applyCurrencyResolution(
  columns: ReportColumnDescriptor[],
  rawRows: readonly Row[],
  groupKeys: readonly string[],
): string[] {
  const mixed: string[] = []
  for (const column of columns) {
    if (column.kind !== 'money' || !column.aggregation || !column.currencyField) continue
    if (groupKeys.includes(column.currencyField)) continue
    const codes = new Set<string>()
    for (const row of rawRows) {
      const value = readFieldValue(row, column.currencyField)
      if (typeof value === 'string' && value.length > 0) codes.add(value.toUpperCase())
      if (codes.size > 1) break
    }
    if (codes.size === 1) {
      column.currency = Array.from(codes)[0]
      delete column.currencyField
    } else if (codes.size > 1) {
      mixed.push(column.key)
      delete column.currencyField
      delete column.currency
    } else {
      delete column.currencyField
    }
  }
  return mixed
}

function buildAggregationQueryOptions(
  definition: Exclude<ReportDefinition, { type: 'flat_list' }>,
  dataset: Dataset,
  ctx: {
    tenantId: string
    organizationId: string
    filters: FilterExpr[]
    cap: number
    rbac?: { userId?: string; userFeatures?: readonly string[] }
  },
): QueryOptions {
  const projection = collectReferencedFields(definition)
  const datasetKeys = new Set(dataset.fields.map((f) => f.key))
  for (const key of projection) {
    if (!datasetKeys.has(key)) {
      throw new Error(`executeReport: field '${key}' is not declared in dataset '${dataset.id}'`)
    }
  }
  for (const currencyField of moneyCurrencyFields(definition, dataset)) {
    if (datasetKeys.has(currencyField) && !projection.includes(currencyField)) projection.push(currencyField)
  }
  // Build a flat_list-shaped slice so we can reuse translateFlatList's filter
  // translator, which is the same code path the flat_list execution uses.
  const flatLikeDefinition: ReportDefinition = {
    type: 'flat_list',
    fields: projection.length > 0 ? projection : dataset.fields.map((f) => f.key),
    filters: [],
    sort: [],
    limit: ctx.cap,
  }
  const opts = translateFlatList(flatLikeDefinition, dataset, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    filters: ctx.filters,
    pageSize: Math.min(ctx.cap, 100),
    page: 1,
    rbac: ctx.rbac,
  })
  return opts
}

/**
 * Build an enum-aware comparator map for the supplied dataset. Each entry
 * maps a field key → enum option index lookup, so a value declared first
 * in the dataset's `options` array sorts before later ones (default enum
 * order). Fields that aren't enums, or enums without inline `options`,
 * are absent from the map and fall back to `compareValues`.
 */
function buildEnumOrderMap(dataset: Dataset): Map<string, (v: unknown) => number> {
  const map = new Map<string, (v: unknown) => number>()
  for (const f of dataset.fields) {
    if (f.kind !== 'enum') continue
    const enumField = f as { options?: Array<string | number | { value: string | number }> }
    const opts = Array.isArray(enumField.options) ? enumField.options : []
    if (opts.length === 0) continue
    const order = new Map<string, number>()
    opts.forEach((opt, i) => {
      const v = typeof opt === 'object' && opt !== null ? String((opt as { value: unknown }).value) : String(opt)
      order.set(v, i)
    })
    map.set(f.key, (value) => {
      if (value == null) return Number.MAX_SAFE_INTEGER
      const idx = order.get(String(value))
      return idx == null ? Number.MAX_SAFE_INTEGER : idx
    })
  }
  return map
}

/**
 * Default ascending sort over the leading enum keys (declared option order),
 * used when a report does not specify its own sort. Non-enum keys keep the
 * aggregator's first-seen order.
 */
function naturalEnumSort(
  keys: readonly string[],
  enumOrder: Map<string, (v: unknown) => number>,
): DslSort[] | undefined {
  const sort: DslSort[] = []
  for (const key of keys) {
    if (!enumOrder.has(key)) break
    sort.push({ field: key, dir: 'asc' })
  }
  return sort.length ? sort : undefined
}

function sortRows(
  rows: Row[],
  sort: DslSort[] | undefined,
  enumOrder?: Map<string, (v: unknown) => number>,
): Row[] {
  if (!sort?.length) return rows
  const sorted = [...rows]
  sorted.sort((a, b) => {
    for (const s of sort) {
      const av = readFieldValue(a, s.field)
      const bv = readFieldValue(b, s.field)
      const enumIdx = enumOrder?.get(s.field)
      let cmp: number
      if (enumIdx) {
        const ai = enumIdx(av)
        const bi = enumIdx(bv)
        cmp = ai === bi ? 0 : ai < bi ? -1 : 1
      } else {
        cmp = compareValues(av, bv)
      }
      if (cmp !== 0) return s.dir === 'desc' ? -cmp : cmp
    }
    return 0
  })
  return sorted
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0
  return String(a).localeCompare(String(b))
}

/**
 * Generic dispatcher — pick the right execution path for the definition
 * type. flat_list still delegates to `executeFlatList`. Aggregated types
 * run a projection query through the QueryEngine and then aggregate the
 * rows in-memory via the Phase 3 aggregator.
 *
 * Returned shape is always `{ mode: 'sync', rows, total, meta }`. For
 * pivot, `rows` is wide-format (one row per row-key combination with
 * one column per col-key combination); for summary it's a single row;
 * for grouped/chart it's one row per group.
 */
export async function executeReport(
  queryEngine: QueryEngine,
  input: ExecutionInput,
): Promise<ExecutionResult> {
  if (input.definition.type === 'flat_list') {
    const out = await executeFlatList(queryEngine, input)
    return { ...out, meta: { ...out.meta, fields: input.definition.fields } }
  }

  const profiler = createReportsProfiler(input.definition, input.dataset)
  const aggregatedDefinition = input.definition
  try {
    // Steps 1 + 2 shared with flat_list: field-ACL + parameter resolution.
    await profiler.measure('field-acl', () => {
      validateDefinitionAgainstAcl(aggregatedDefinition, input.dataset, input.userFeatures)
    })
    const now = input.now ?? new Date()
    const boundFilters = await profiler.measure('parameters', () => {
      const resolved = resolveParameters(input.params, input.parameterDefs, now)
      return bindFiltersToParameters(aggregatedDefinition.filters, resolved, now)
    })

    const cap = Math.max(1, input.inMemoryCap ?? readEnvCap())
    const queryOpts = await profiler.measure('translate', () =>
      buildAggregationQueryOptions(aggregatedDefinition, input.dataset, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        filters: boundFilters,
        cap,
        rbac: { userId: input.userId, userFeatures: [...input.userFeatures] },
      }),
    )

    const started = Date.now()
    const read = await profiler.measure('query.execute', () =>
      readPagesUntilCap(queryEngine, input.dataset.entityType, queryOpts, cap),
    )
    const rawRows = read.rows
    const truncated = read.total !== null ? read.total > rawRows.length : rawRows.length >= cap

    let rows: Row[] = []
    let outFields: string[] = []
    let limit: number | undefined

    const enumOrder = buildEnumOrderMap(input.dataset)
    if (input.definition.type === 'grouped') {
      const def = input.definition
      await profiler.measure('aggregate.grouped', () => {
        rows = aggregateGroupBy({
          rows: rawRows,
          groupBy: def.groupBy,
          measures: def.measures,
        })
        // Default to enum-order sort when the report doesn't specify one
        // and the first groupBy key is an enum with declared options. This
        // is what users typically expect (status: open → won → lost), not
        // alphabetical (lost → open → won).
        const effectiveSort = def.sort?.length ? def.sort : naturalEnumSort(def.groupBy, enumOrder)
        rows = sortRows(rows, effectiveSort, enumOrder)
        limit = def.limit
        outFields = [
          ...def.groupBy,
          ...def.measures.map((m) => measureAlias(m)),
        ]
      })
    } else if (input.definition.type === 'summary') {
      const def = input.definition
      await profiler.measure('aggregate.summary', () => {
        const summaryRow = aggregateSummary({
          rows: rawRows,
          measures: def.measures,
        })
        rows = [summaryRow]
        outFields = def.measures.map((m) => measureAlias(m))
      })
    } else if (input.definition.type === 'pivot') {
      const def = input.definition
      await profiler.measure('aggregate.pivot', () => {
        if (!def.value) {
          // Validators should reject this, but be defensive at runtime.
          rows = []
          outFields = [...def.rows]
          return
        }
        const valueMeasure: MeasureExpr = def.value
        const rawPivot = aggregatePivot({
          rows: rawRows,
          rowKeys: def.rows,
          colKeys: def.cols,
          value: valueMeasure,
        })
        // Natural order for enum axes: declared option order, not first-seen.
        const pivot = {
          ...rawPivot,
          rowHeaders: sortRows([...rawPivot.rowHeaders], naturalEnumSort(def.rows, enumOrder), enumOrder),
          colHeaders: sortRows([...rawPivot.colHeaders], naturalEnumSort(def.cols, enumOrder), enumOrder),
        }
        rows = pivotToWideRows(pivot)
        const colHeaderLabels = pivot.colHeaders.map((h) =>
          Object.values(h).map((v) => (v === null || v === undefined ? '∅' : String(v))).join('|'),
        )
        outFields = [...def.rows, ...colHeaderLabels]
      })
    } else {
      const def = input.definition
      await profiler.measure('aggregate.chart', () => {
        const chartGroupBy = effectiveChartGroupBy(def)
        rows = aggregateGroupBy({
          rows: rawRows,
          groupBy: chartGroupBy,
          measures: def.measures ?? [],
        })
        rows = sortRows(rows, naturalEnumSort(chartGroupBy, enumOrder), enumOrder)
        limit = def.limit
        outFields = [
          ...chartGroupBy,
          ...(def.measures ?? []).map((m) => measureAlias(m)),
        ]
      })
    }

    if (typeof limit === 'number' && limit > 0 && rows.length > limit) {
      rows = rows.slice(0, limit)
    }

    const columns = buildColumnDescriptors(input.definition, input.dataset, outFields)
    const groupKeys =
      input.definition.type === 'grouped'
        ? input.definition.groupBy
        : input.definition.type === 'chart'
          ? effectiveChartGroupBy(input.definition)
          : input.definition.type === 'pivot'
            ? [...input.definition.rows, ...input.definition.cols]
            : []
    const mixedCurrencyColumns = applyCurrencyResolution(columns, rawRows, groupKeys)

    const duration_ms = Date.now() - started
    profiler.end({ rows: rows.length, rawRows: rawRows.length, truncated, cap })
    return {
      mode: 'sync',
      rows,
      total: rows.length,
      meta: {
        duration_ms,
        truncated,
        cap,
        fields: outFields,
        columns,
        scannedRows: rawRows.length,
        ...(mixedCurrencyColumns.length > 0 ? { mixedCurrencyColumns } : {}),
      },
    }
  } catch (err) {
    profiler.end({ error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}
