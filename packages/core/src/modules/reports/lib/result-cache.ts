import { createHash } from 'node:crypto'
import type { Dataset, ParameterDef, ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { executeReport, type ExecutionInput, type ExecutionResult } from './execute'

/**
 * Narrow contract for the cache service the result cache talks to.
 *
 * Keep it small on purpose — the reports module should not bind to the full
 * `@open-mercato/cache` surface (other strategies like SQLite, JSON, or
 * tenant-aware wrappers all satisfy this shape) and the contract is what unit
 * tests pretend to be.
 */
export type ReportsCacheService = {
  get(key: string, options?: { returnExpired?: boolean }): Promise<unknown>
  set(key: string, value: unknown, options?: { ttl?: number; tags?: string[] }): Promise<void>
  deleteByTags(tags: string[]): Promise<number>
}

export type ReportsCacheKeyInput = {
  reportId: string
  tenantId: string
  organizationId: string
  definition: ReportDefinition
  params: Record<string, unknown> | undefined
  parameterDefs: ParameterDef[] | undefined
  userFeatureFingerprint?: string | null
}

export const REPORTS_CACHE_DEFAULT_TTL_MS = 5 * 60_000

const REPORTS_CACHE_KEY_PREFIX = 'reports:result'

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const parts: string[] = []
  for (const key of keys) parts.push(JSON.stringify(key) + ':' + stableStringify(obj[key]))
  return '{' + parts.join(',') + '}'
}

function hashPayload(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 32)
}

export function buildReportCacheKey(input: ReportsCacheKeyInput): string {
  const payload = {
    definition: input.definition,
    params: input.params ?? {},
    parameterDefs: input.parameterDefs ?? [],
    features: input.userFeatureFingerprint ?? null,
  }
  const digest = hashPayload(payload)
  return `${REPORTS_CACHE_KEY_PREFIX}:${input.tenantId}:${input.organizationId}:${input.reportId}:${digest}`
}

export function buildReportCacheTags(input: {
  tenantId: string
  organizationId: string
  reportId: string
  datasetId: string
}): string[] {
  return [
    `tenant:${input.tenantId}`,
    `reports:org:${input.organizationId}`,
    `reports:report:${input.reportId}`,
    `reports:dataset:${input.datasetId}`,
  ]
}

export function buildReportInvalidationTags(input: {
  tenantId: string
  reportId?: string | null
  datasetId?: string | null
}): string[] {
  const tags = [`tenant:${input.tenantId}`]
  if (input.reportId) tags.push(`reports:report:${input.reportId}`)
  if (input.datasetId) tags.push(`reports:dataset:${input.datasetId}`)
  return tags
}

export function buildUserFeatureFingerprint(userFeatures: ReadonlySet<string>): string {
  if (userFeatures.has('*')) return '*'
  if (!userFeatures.size) return ''
  const sorted = Array.from(userFeatures).sort()
  return createHash('sha256').update(sorted.join('|')).digest('hex').slice(0, 16)
}

type ExecuteReportFn = (queryEngine: QueryEngine, input: ExecutionInput) => Promise<ExecutionResult>

export type CachedExecuteOptions = {
  cache: ReportsCacheService | null | undefined
  reportId: string
  dataset: Dataset
  ttlMs?: number
  /** Override the executor — tests pass a stub. Defaults to `executeReport`. */
  executor?: ExecuteReportFn
}

export type CachedExecutionResult = ExecutionResult & {
  meta: ExecutionResult['meta'] & { cached?: boolean }
}

/**
 * Wrap `executeReport` with read-through caching.
 *
 * The cache is keyed by `(reportId, tenantId, organizationId, definition,
 * params, parameterDefs, userFeatureFingerprint)`. Field-ACL drift between
 * users is the reason `userFeatureFingerprint` participates in the key —
 * two users with different feature sets MUST NOT share a cached result.
 *
 * Cached results are tagged so command-side-effects can invalidate them in
 * bulk: `tenant:<id>`, `reports:org:<id>`, `reports:report:<id>`,
 * `reports:dataset:<id>`.
 */
export async function executeReportCached(
  queryEngine: QueryEngine,
  input: ExecutionInput,
  options: CachedExecuteOptions,
): Promise<CachedExecutionResult> {
  const executor = options.executor ?? executeReport
  if (!options.cache) {
    const result = await executor(queryEngine, input)
    return { ...result, meta: { ...result.meta, cached: false } }
  }

  const fingerprint = buildUserFeatureFingerprint(input.userFeatures)
  const key = buildReportCacheKey({
    reportId: options.reportId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    definition: input.definition,
    params: input.params,
    parameterDefs: input.parameterDefs,
    userFeatureFingerprint: fingerprint,
  })

  const cached = await options.cache.get(key)
  if (cached && typeof cached === 'object') {
    const candidate = cached as ExecutionResult
    if (candidate.mode === 'sync' && Array.isArray(candidate.rows)) {
      return { ...candidate, meta: { ...candidate.meta, cached: true } }
    }
  }

  const result = await executor(queryEngine, input)
  // Never cache truncated results — they could mask growing datasets.
  if (result.meta.truncated) {
    return { ...result, meta: { ...result.meta, cached: false } }
  }

  const tags = buildReportCacheTags({
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    reportId: options.reportId,
    datasetId: options.dataset.id,
  })
  const ttl = options.ttlMs ?? REPORTS_CACHE_DEFAULT_TTL_MS
  await options.cache.set(key, result, { ttl, tags })
  return { ...result, meta: { ...result.meta, cached: false } }
}

/**
 * Helper used by command side-effects + subscribers to drop cached results
 * after a report definition changes or its underlying dataset entity is
 * mutated.
 */
export async function invalidateReportCache(
  cache: ReportsCacheService | null | undefined,
  tags: string[],
): Promise<number> {
  if (!cache || !tags.length) return 0
  return cache.deleteByTags(tags)
}
