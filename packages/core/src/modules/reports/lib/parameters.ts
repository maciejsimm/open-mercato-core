import type {
  DateRangeToken,
  FilterExpr,
  ParameterDef,
} from '@open-mercato/shared/modules/reports/dsl'
import { isDateRangeToken, resolveDateRange, type DateRange } from './date-ranges'

export type ResolvedParameters = Map<string, ParameterValue>

export type ParameterValue =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'date'; value: string }
  | { kind: 'date_range'; value: DateRange; token: DateRangeToken }
  | { kind: 'fk'; value: string }
  | { kind: 'enum'; value: string | number }

export class ParameterError extends Error {
  code = 'REPORT_PARAMETER_INVALID' as const
  parameter: string
  reason: string
  constructor(parameter: string, reason: string) {
    super(`Parameter '${parameter}' invalid: ${reason}`)
    this.parameter = parameter
    this.reason = reason
  }
}

function coerceString(raw: unknown, key: string): string {
  if (typeof raw !== 'string') throw new ParameterError(key, 'expected string')
  return raw
}
function coerceNumber(raw: unknown, key: string): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    if (Number.isFinite(n)) return n
  }
  throw new ParameterError(key, 'expected number')
}
function coerceBoolean(raw: unknown, key: string): boolean {
  if (typeof raw === 'boolean') return raw
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  throw new ParameterError(key, 'expected boolean')
}
function coerceDate(raw: unknown, key: string): string {
  if (typeof raw !== 'string' || !raw) throw new ParameterError(key, 'expected ISO date string')
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) throw new ParameterError(key, 'expected ISO date string')
  return d.toISOString()
}

function coerceDateRange(raw: unknown, key: string, now: Date): { token: DateRangeToken; range: DateRange } {
  if (typeof raw === 'string') {
    if (!isDateRangeToken(raw)) throw new ParameterError(key, `unknown date range token '${raw}'`)
    if (raw === 'custom') throw new ParameterError(key, `'custom' requires { from, to } object`)
    return { token: raw, range: resolveDateRange(raw, now) }
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as { token?: unknown; from?: unknown; to?: unknown }
    const token = obj.token ?? 'custom'
    if (!isDateRangeToken(token)) throw new ParameterError(key, `unknown date range token`)
    if (token === 'custom') {
      const from = typeof obj.from === 'string' ? obj.from : undefined
      const to = typeof obj.to === 'string' ? obj.to : undefined
      if (!from || !to) throw new ParameterError(key, `'custom' requires from and to`)
      return { token, range: resolveDateRange('custom', now, { from, to }) }
    }
    return { token, range: resolveDateRange(token, now) }
  }
  throw new ParameterError(key, 'expected date range token string or { token, from, to } object')
}

/**
 * Resolve a map of raw parameter inputs (URL params, request body) against
 * the dataset/report's declared `ParameterDef[]`. Missing required params
 * throw `ParameterError`.
 */
export function resolveParameters(
  raw: Record<string, unknown> | undefined,
  defs: ParameterDef[] | undefined,
  now: Date = new Date(),
): ResolvedParameters {
  const out: ResolvedParameters = new Map()
  if (!defs?.length) return out
  for (const def of defs) {
    const present = raw && Object.prototype.hasOwnProperty.call(raw, def.key)
    if (!present) {
      if (def.required && def.defaultValue === undefined) {
        throw new ParameterError(def.key, 'required parameter missing')
      }
      if (def.defaultValue === undefined) continue
    }
    const value = present ? raw![def.key] : def.defaultValue
    switch (def.kind) {
      case 'string':
        out.set(def.key, { kind: 'string', value: coerceString(value, def.key) })
        break
      case 'number':
        out.set(def.key, { kind: 'number', value: coerceNumber(value, def.key) })
        break
      case 'boolean':
        out.set(def.key, { kind: 'boolean', value: coerceBoolean(value, def.key) })
        break
      case 'date':
        out.set(def.key, { kind: 'date', value: coerceDate(value, def.key) })
        break
      case 'date_range': {
        const { token, range } = coerceDateRange(value, def.key, now)
        out.set(def.key, { kind: 'date_range', value: range, token })
        break
      }
      case 'fk':
        out.set(def.key, { kind: 'fk', value: coerceString(value, def.key) })
        break
      case 'enum': {
        const str = typeof value === 'number' ? value : coerceString(value, def.key)
        const allowed = def.options?.map((opt) => (typeof opt === 'object' ? opt.value : opt)) ?? []
        if (allowed.length && !allowed.includes(str)) {
          throw new ParameterError(def.key, `value not in allowed options`)
        }
        out.set(def.key, { kind: 'enum', value: str })
        break
      }
    }
  }
  return out
}

/**
 * Replace `kind: 'parameter'` and `kind: 'date_range'` filter nodes in a
 * report definition with `kind: 'literal'` filters bound to resolved
 * parameter values. Filters that reference a missing parameter are dropped.
 */
export function bindFiltersToParameters(
  filters: FilterExpr[],
  resolved: ResolvedParameters,
  now: Date = new Date(),
): FilterExpr[] {
  return filters
    .map((filter) => bindFilter(filter, resolved, now))
    .filter((f): f is FilterExpr => f !== null)
}

function bindFilter(filter: FilterExpr, resolved: ResolvedParameters, now: Date): FilterExpr | null {
  if (filter.kind === 'group') {
    const children = filter.children
      .map((c) => bindFilter(c, resolved, now))
      .filter((c): c is FilterExpr => c !== null)
    if (children.length === 0) return null
    return { kind: 'group', op: filter.op, children }
  }
  if (filter.kind === 'literal') return filter
  if (filter.kind === 'parameter') {
    const v = resolved.get(filter.parameter)
    if (!v) return null
    return { kind: 'literal', field: filter.field, op: filter.op, value: extractValue(v) }
  }
  if (filter.kind === 'date_range') {
    const range = resolveDateRange(filter.token, now, { from: filter.from, to: filter.to })
    return {
      kind: 'group',
      op: 'and',
      children: [
        { kind: 'literal', field: filter.field, op: 'gte', value: range.from },
        { kind: 'literal', field: filter.field, op: 'lte', value: range.to },
      ],
    }
  }
  return filter
}

function extractValue(v: ParameterValue): unknown {
  if (v.kind === 'date_range') return v.value
  return (v as { value: unknown }).value
}
