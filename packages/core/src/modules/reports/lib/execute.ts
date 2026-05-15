import type {
  Dataset,
  FilterExpr,
  ParameterDef,
  ReportDefinition,
  Sort as DslSort,
} from '@open-mercato/shared/modules/reports/dsl'
import { SortDir, type Filter, type QueryEngine, type QueryOptions, type Sort } from '@open-mercato/shared/lib/query/types'
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
  }
}

export type AsyncDispatch = {
  mode: 'async'
  reason: 'over_cap' | 'requested'
  estimatedRows: number
  cap: number
}

function readEnvCap(): number {
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

  // Step 1: field-ACL — re-resolved against the running user.
  validateDefinitionAgainstAcl(input.definition, input.dataset, input.userFeatures)

  // Step 2: parameter resolution + filter binding.
  const now = input.now ?? new Date()
  const resolved = resolveParameters(input.params, input.parameterDefs, now)
  const boundFilters = bindFiltersToParameters(input.definition.filters, resolved, now)

  // Step 3: query translation.
  const cap = Math.max(1, input.inMemoryCap ?? readEnvCap())
  const opts = translateFlatList(input.definition, input.dataset, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    filters: boundFilters,
    pageSize: Math.min(cap, 100),
    page: 1,
  })

  // Step 4: run + measure.
  const started = Date.now()
  const result = await queryEngine.query(input.dataset.entityType, opts)
  const duration_ms = Date.now() - started

  const rows = result.items as Record<string, unknown>[]
  const total = typeof result.total === 'number' ? result.total : rows.length
  const truncated = rows.length >= cap

  return {
    mode: 'sync',
    rows,
    total,
    meta: { duration_ms, truncated, cap },
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
      for (const g of definition.groupBy ?? []) add(g)
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

function buildAggregationQueryOptions(
  definition: Exclude<ReportDefinition, { type: 'flat_list' }>,
  dataset: Dataset,
  ctx: {
    tenantId: string
    organizationId: string
    filters: FilterExpr[]
    cap: number
  },
): QueryOptions {
  const projection = collectReferencedFields(definition)
  const datasetKeys = new Set(dataset.fields.map((f) => f.key))
  for (const key of projection) {
    if (!datasetKeys.has(key)) {
      throw new Error(`executeReport: field '${key}' is not declared in dataset '${dataset.id}'`)
    }
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
  })
  return opts
}

function sortRows(rows: Row[], sort: DslSort[] | undefined): Row[] {
  if (!sort?.length) return rows
  const sorted = [...rows]
  sorted.sort((a, b) => {
    for (const s of sort) {
      const av = readFieldValue(a, s.field)
      const bv = readFieldValue(b, s.field)
      const cmp = compareValues(av, bv)
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

  // Steps 1 + 2 shared with flat_list: field-ACL + parameter resolution.
  validateDefinitionAgainstAcl(input.definition, input.dataset, input.userFeatures)
  const now = input.now ?? new Date()
  const resolved = resolveParameters(input.params, input.parameterDefs, now)
  const boundFilters = bindFiltersToParameters(input.definition.filters, resolved, now)

  const cap = Math.max(1, input.inMemoryCap ?? readEnvCap())
  const queryOpts = buildAggregationQueryOptions(input.definition, input.dataset, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    filters: boundFilters,
    cap,
  })

  const started = Date.now()
  const result = await queryEngine.query(input.dataset.entityType, queryOpts)
  const rawRows = result.items as Row[]
  const truncated = rawRows.length >= cap

  let rows: Row[] = []
  let outFields: string[] = []
  let limit: number | undefined

  if (input.definition.type === 'grouped') {
    rows = aggregateGroupBy({
      rows: rawRows,
      groupBy: input.definition.groupBy,
      measures: input.definition.measures,
    })
    rows = sortRows(rows, input.definition.sort)
    limit = input.definition.limit
    outFields = [
      ...input.definition.groupBy,
      ...input.definition.measures.map((m) => measureAlias(m)),
    ]
  } else if (input.definition.type === 'summary') {
    const summaryRow = aggregateSummary({
      rows: rawRows,
      measures: input.definition.measures,
    })
    rows = [summaryRow]
    outFields = input.definition.measures.map((m) => measureAlias(m))
  } else if (input.definition.type === 'pivot') {
    if (!input.definition.value) {
      // Validators should reject this, but be defensive at runtime.
      rows = []
      outFields = [...input.definition.rows]
    } else {
      const valueMeasure: MeasureExpr = input.definition.value
      const pivot = aggregatePivot({
        rows: rawRows,
        rowKeys: input.definition.rows,
        colKeys: input.definition.cols,
        value: valueMeasure,
      })
      rows = pivotToWideRows(pivot)
      const colHeaderLabels = pivot.colHeaders.map((h) =>
        Object.values(h).map((v) => (v === null || v === undefined ? '∅' : String(v))).join('|'),
      )
      outFields = [...input.definition.rows, ...colHeaderLabels]
    }
  } else {
    // chart
    rows = aggregateGroupBy({
      rows: rawRows,
      groupBy: input.definition.groupBy ?? [],
      measures: input.definition.measures ?? [],
    })
    limit = input.definition.limit
    outFields = [
      ...(input.definition.groupBy ?? []),
      ...(input.definition.measures ?? []).map((m) => measureAlias(m)),
    ]
  }

  if (typeof limit === 'number' && limit > 0 && rows.length > limit) {
    rows = rows.slice(0, limit)
  }

  const duration_ms = Date.now() - started
  return {
    mode: 'sync',
    rows,
    total: rows.length,
    meta: { duration_ms, truncated, cap, fields: outFields },
  }
}
