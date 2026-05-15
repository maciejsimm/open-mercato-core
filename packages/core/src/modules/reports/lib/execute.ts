import type {
  Dataset,
  ParameterDef,
  ReportDefinition,
} from '@open-mercato/shared/modules/reports/dsl'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { bindFiltersToParameters, resolveParameters } from './parameters'
import { validateDefinitionAgainstAcl } from './field-redact'
import { translateFlatList } from './query-translator'

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
