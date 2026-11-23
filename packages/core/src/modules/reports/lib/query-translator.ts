import type {
  Dataset,
  FilterExpr,
  ReportDefinition,
  Sort as DslSort,
} from '@open-mercato/shared/modules/reports/dsl'
import { SortDir, type Filter, type QueryOptions, type Sort } from '@open-mercato/shared/lib/query/types'

export type TranslateContext = {
  tenantId: string
  organizationId: string
  /** Resolved + bound filters (parameters already substituted). */
  filters?: FilterExpr[]
  /** Optional max rows to read. Falls back to definition.limit, then 100. */
  pageSize?: number
  /** Optional starting page. Default 1. */
  page?: number
  /**
   * Running user identity forwarded to the QueryEngine as UMES `extensions`
   * so row-level RBAC (sync `*.querying` subscribers + query enrichers)
   * applies to report reads.
   */
  rbac?: { userId?: string; userFeatures?: readonly string[] }
}

const SUPPORTED_OPS: Record<string, Filter['op']> = {
  eq: 'eq',
  ne: 'ne',
  gt: 'gt',
  gte: 'gte',
  lt: 'lt',
  lte: 'lte',
  in: 'in',
  nin: 'nin',
  contains: 'ilike',
  starts_with: 'ilike',
  ends_with: 'ilike',
  is_null: 'exists',
  is_not_null: 'exists',
  between: 'gte',
}

export class UnsupportedFilterError extends Error {
  code = 'REPORT_FILTER_UNSUPPORTED' as const
  constructor(message: string) {
    super(message)
  }
}

function flattenFilters(filters: FilterExpr[] | undefined): FilterExpr[] {
  if (!filters?.length) return []
  const out: FilterExpr[] = []
  for (const f of filters) {
    if (f.kind === 'group') {
      if (f.op === 'and') out.push(...flattenFilters(f.children))
      else out.push(f)
    } else {
      out.push(f)
    }
  }
  return out
}

function translateFilter(filter: FilterExpr): Filter[] {
  if (filter.kind === 'group') {
    throw new UnsupportedFilterError(
      'OR filter groups are not supported by the flat_list translator yet — split into separate reports or use Phase 2 aggregator',
    )
  }
  if (filter.kind === 'parameter') {
    throw new UnsupportedFilterError(
      `Unresolved parameter '${filter.parameter}' for field '${filter.field}' — bindFiltersToParameters must run before translation`,
    )
  }
  if (filter.kind === 'date_range') {
    throw new UnsupportedFilterError(
      `Unresolved date_range filter on '${filter.field}' — bindFiltersToParameters must run before translation`,
    )
  }
  const op = SUPPORTED_OPS[filter.op]
  if (!op) throw new UnsupportedFilterError(`Unsupported filter op '${filter.op}'`)
  switch (filter.op) {
    case 'contains':
      return [{ field: filter.field, op: 'ilike', value: `%${String(filter.value ?? '')}%` }]
    case 'starts_with':
      return [{ field: filter.field, op: 'ilike', value: `${String(filter.value ?? '')}%` }]
    case 'ends_with':
      return [{ field: filter.field, op: 'ilike', value: `%${String(filter.value ?? '')}` }]
    case 'is_null':
      return [{ field: filter.field, op: 'exists', value: false }]
    case 'is_not_null':
      return [{ field: filter.field, op: 'exists', value: true }]
    case 'between': {
      const value = filter.value as { from?: unknown; to?: unknown }
      if (!value || value.from === undefined || value.to === undefined) {
        throw new UnsupportedFilterError(`'between' requires { from, to }`)
      }
      return [
        { field: filter.field, op: 'gte', value: value.from },
        { field: filter.field, op: 'lte', value: value.to },
      ]
    }
    default:
      return [{ field: filter.field, op, value: filter.value }]
  }
}

function translateSort(sort: DslSort[] | undefined): Sort[] | undefined {
  if (!sort?.length) return undefined
  return sort.map((s) => ({
    field: s.field,
    dir: s.dir === 'desc' ? SortDir.Desc : SortDir.Asc,
  }))
}

/**
 * Translate a `flat_list` report definition into a QueryOptions payload the
 * platform's QueryEngine understands.
 *
 * Tenant + organization scopes are mandatory; this function refuses to emit a
 * QueryOptions without them so we cannot accidentally bypass tenant isolation.
 *
 * Filters must be **bound** beforehand via `bindFiltersToParameters` — any
 * `parameter` or `date_range` node still present is an authoring error and
 * raises `UnsupportedFilterError`.
 */
export function translateFlatList(
  definition: ReportDefinition,
  dataset: Dataset,
  ctx: TranslateContext,
): QueryOptions {
  if (definition.type !== 'flat_list') {
    throw new Error(`translateFlatList only supports flat_list definitions (got '${definition.type}')`)
  }
  if (!ctx.tenantId) throw new Error('translateFlatList: tenantId is required')
  if (!ctx.organizationId) throw new Error('translateFlatList: organizationId is required')

  const datasetFieldKeys = new Set(dataset.fields.map((f) => f.key))
  for (const field of definition.fields) {
    if (!datasetFieldKeys.has(field)) {
      throw new Error(`translateFlatList: field '${field}' is not declared in dataset '${dataset.id}'`)
    }
  }
  const filtersIn = ctx.filters ?? definition.filters
  const flatFilters = flattenFilters(filtersIn)
  const filters: Filter[] = []
  for (const f of flatFilters) filters.push(...translateFilter(f))

  const sort = translateSort(definition.sort) ?? translateSort(dataset.defaultSort)
  const pageSize = Math.min(
    Math.max(1, ctx.pageSize ?? definition.limit ?? dataset.defaultPageSize ?? 100),
    100,
  )

  return {
    fields: definition.fields,
    filters,
    sort,
    page: { page: ctx.page ?? 1, pageSize },
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    includeCustomFields: hasCustomFieldFields(definition.fields),
    ...(ctx.rbac && (ctx.rbac.userId || ctx.rbac.userFeatures)
      ? {
          extensions: {
            ...(ctx.rbac.userId ? { userId: ctx.rbac.userId } : {}),
            ...(ctx.rbac.userFeatures ? { userFeatures: [...ctx.rbac.userFeatures] } : {}),
          },
        }
      : {}),
  }
}

function hasCustomFieldFields(fields: string[]): boolean | string[] {
  const cfKeys = fields.filter((f) => f.startsWith('cf:'))
  if (cfKeys.length === fields.length) return true
  if (cfKeys.length === 0) return false
  return cfKeys.map((k) => k.replace(/^cf:/, ''))
}
