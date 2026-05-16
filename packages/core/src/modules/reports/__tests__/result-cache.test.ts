import type { Dataset, ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import {
  buildReportCacheKey,
  buildReportCacheTags,
  buildReportInvalidationTags,
  buildUserFeatureFingerprint,
  executeReportCached,
  invalidateReportCache,
  type ReportsCacheService,
} from '../lib/result-cache'
import type { ExecutionInput, ExecutionResult } from '../lib/execute'

const dataset: Dataset = {
  id: 'customers:person',
  module: 'customers',
  label: 'People',
  entityType: 'customers:person',
  features: [],
  fields: [
    { key: 'id', label: 'ID', kind: 'string' },
    { key: 'firstName', label: 'First name', kind: 'string' },
  ],
  parameters: [],
}

const definition: ReportDefinition = {
  type: 'flat_list',
  fields: ['id', 'firstName'],
  filters: [],
  sort: [],
}

function makeCache(): ReportsCacheService & {
  store: Map<string, { value: unknown; tags: string[] }>
  setCalls: Array<{ key: string; tags: string[] }>
  invalidations: string[][]
} {
  const store = new Map<string, { value: unknown; tags: string[] }>()
  const setCalls: Array<{ key: string; tags: string[] }> = []
  const invalidations: string[][] = []
  return {
    store,
    setCalls,
    invalidations,
    async get(key) {
      const entry = store.get(key)
      return entry ? entry.value : null
    },
    async set(key, value, options) {
      store.set(key, { value, tags: options?.tags ?? [] })
      setCalls.push({ key, tags: options?.tags ?? [] })
    },
    async deleteByTags(tags) {
      invalidations.push(tags)
      let removed = 0
      for (const [key, entry] of store.entries()) {
        if (entry.tags.some((tag) => tags.includes(tag))) {
          store.delete(key)
          removed += 1
        }
      }
      return removed
    },
  }
}

function makeInput(overrides: Partial<ExecutionInput> = {}): ExecutionInput {
  return {
    dataset,
    definition,
    userFeatures: new Set(['*']),
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    params: {},
    ...overrides,
  }
}

const queryEngineStub: QueryEngine = {
  async query() {
    return { items: [], total: 0 }
  },
} as unknown as QueryEngine

const successResult: ExecutionResult = {
  mode: 'sync',
  rows: [{ id: 'a', firstName: 'Ada' }],
  total: 1,
  meta: { duration_ms: 1, truncated: false, cap: 25000 },
}

describe('buildReportCacheKey', () => {
  it('is stable across param key ordering', () => {
    const a = buildReportCacheKey({
      reportId: 'r1',
      tenantId: 't1',
      organizationId: 'o1',
      definition,
      params: { from: '2026-01-01', to: '2026-02-01' },
      parameterDefs: [],
      userFeatureFingerprint: 'x',
    })
    const b = buildReportCacheKey({
      reportId: 'r1',
      tenantId: 't1',
      organizationId: 'o1',
      definition,
      params: { to: '2026-02-01', from: '2026-01-01' },
      parameterDefs: [],
      userFeatureFingerprint: 'x',
    })
    expect(a).toBe(b)
  })

  it('changes when parameters change', () => {
    const a = buildReportCacheKey({
      reportId: 'r1',
      tenantId: 't1',
      organizationId: 'o1',
      definition,
      params: { from: '2026-01-01' },
      parameterDefs: [],
      userFeatureFingerprint: 'x',
    })
    const b = buildReportCacheKey({
      reportId: 'r1',
      tenantId: 't1',
      organizationId: 'o1',
      definition,
      params: { from: '2026-02-01' },
      parameterDefs: [],
      userFeatureFingerprint: 'x',
    })
    expect(a).not.toBe(b)
  })

  it('changes when user feature fingerprint changes', () => {
    const a = buildReportCacheKey({
      reportId: 'r1',
      tenantId: 't1',
      organizationId: 'o1',
      definition,
      params: {},
      parameterDefs: [],
      userFeatureFingerprint: 'alpha',
    })
    const b = buildReportCacheKey({
      reportId: 'r1',
      tenantId: 't1',
      organizationId: 'o1',
      definition,
      params: {},
      parameterDefs: [],
      userFeatureFingerprint: 'beta',
    })
    expect(a).not.toBe(b)
  })
})

describe('buildUserFeatureFingerprint', () => {
  it('returns "*" for super admin', () => {
    expect(buildUserFeatureFingerprint(new Set(['*']))).toBe('*')
  })
  it('is order-independent', () => {
    const a = buildUserFeatureFingerprint(new Set(['reports.view', 'reports.create']))
    const b = buildUserFeatureFingerprint(new Set(['reports.create', 'reports.view']))
    expect(a).toBe(b)
  })
})

describe('buildReportCacheTags', () => {
  it('includes tenant, org, report, and dataset tags', () => {
    const tags = buildReportCacheTags({
      tenantId: 't1',
      organizationId: 'o1',
      reportId: 'r1',
      datasetId: 'customers:person',
    })
    expect(tags).toContain('tenant:t1')
    expect(tags).toContain('reports:org:o1')
    expect(tags).toContain('reports:report:r1')
    expect(tags).toContain('reports:dataset:customers:person')
  })
})

describe('buildReportInvalidationTags', () => {
  it('emits tenant + report tags when both are provided', () => {
    const tags = buildReportInvalidationTags({ tenantId: 't1', reportId: 'r1', datasetId: 'd1' })
    expect(tags).toEqual(['tenant:t1', 'reports:report:r1', 'reports:dataset:d1'])
  })
  it('skips empty ids', () => {
    expect(buildReportInvalidationTags({ tenantId: 't1' })).toEqual(['tenant:t1'])
  })
})

describe('executeReportCached', () => {
  it('executes and caches on miss', async () => {
    const cache = makeCache()
    let calls = 0
    const result = await executeReportCached(queryEngineStub, makeInput(), {
      cache,
      reportId: 'r1',
      dataset,
      executor: async () => {
        calls += 1
        return successResult
      },
    })
    expect(calls).toBe(1)
    expect(result.meta.cached).toBe(false)
    expect(cache.setCalls).toHaveLength(1)
    expect(cache.setCalls[0].tags).toContain('reports:report:r1')
  })

  it('returns cached result on hit without re-executing', async () => {
    const cache = makeCache()
    let calls = 0
    const executor = async () => {
      calls += 1
      return successResult
    }
    await executeReportCached(queryEngineStub, makeInput(), { cache, reportId: 'r1', dataset, executor })
    const second = await executeReportCached(queryEngineStub, makeInput(), { cache, reportId: 'r1', dataset, executor })
    expect(calls).toBe(1)
    expect(second.meta.cached).toBe(true)
    expect(second.rows).toEqual(successResult.rows)
  })

  it('bypasses the cache when no service is provided', async () => {
    let calls = 0
    const executor = async () => {
      calls += 1
      return successResult
    }
    await executeReportCached(queryEngineStub, makeInput(), {
      cache: null,
      reportId: 'r1',
      dataset,
      executor,
    })
    await executeReportCached(queryEngineStub, makeInput(), {
      cache: null,
      reportId: 'r1',
      dataset,
      executor,
    })
    expect(calls).toBe(2)
  })

  it('does not cache truncated results', async () => {
    const cache = makeCache()
    const truncatedResult: ExecutionResult = {
      mode: 'sync',
      rows: [],
      total: 25_000,
      meta: { duration_ms: 5, truncated: true, cap: 25_000 },
    }
    await executeReportCached(queryEngineStub, makeInput(), {
      cache,
      reportId: 'r1',
      dataset,
      executor: async () => truncatedResult,
    })
    expect(cache.setCalls).toHaveLength(0)
  })

  it('uses different cache keys for different users (feature fingerprint)', async () => {
    const cache = makeCache()
    const executor = jest.fn().mockResolvedValue(successResult)
    await executeReportCached(queryEngineStub, makeInput({ userFeatures: new Set(['reports.view']) }), {
      cache,
      reportId: 'r1',
      dataset,
      executor,
    })
    await executeReportCached(queryEngineStub, makeInput({ userFeatures: new Set(['*']) }), {
      cache,
      reportId: 'r1',
      dataset,
      executor,
    })
    expect(executor).toHaveBeenCalledTimes(2)
    expect(cache.setCalls).toHaveLength(2)
    expect(cache.setCalls[0].key).not.toBe(cache.setCalls[1].key)
  })
})

describe('invalidateReportCache', () => {
  it('passes tags through to deleteByTags', async () => {
    const cache = makeCache()
    await cache.set('k', 'v', { tags: ['reports:report:r1'] })
    const removed = await invalidateReportCache(cache, ['reports:report:r1'])
    expect(removed).toBe(1)
    expect(cache.invalidations).toEqual([['reports:report:r1']])
  })

  it('is a no-op when cache is null', async () => {
    const removed = await invalidateReportCache(null, ['reports:report:r1'])
    expect(removed).toBe(0)
  })

  it('is a no-op for an empty tag list', async () => {
    const cache = makeCache()
    const removed = await invalidateReportCache(cache, [])
    expect(removed).toBe(0)
    expect(cache.invalidations).toEqual([])
  })
})
