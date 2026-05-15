import {
  ParameterError,
  bindFiltersToParameters,
  resolveParameters,
} from '../lib/parameters'
import type { FilterExpr, ParameterDef } from '@open-mercato/shared/modules/reports/dsl'

const NOW = new Date(Date.UTC(2026, 4, 15, 12, 0, 0)) // 2026-05-15T12:00:00Z

describe('resolveParameters', () => {
  test('coerces strings, numbers, booleans, dates', () => {
    const defs: ParameterDef[] = [
      { key: 'q', kind: 'string' },
      { key: 'limit', kind: 'number' },
      { key: 'active', kind: 'boolean' },
      { key: 'from', kind: 'date' },
    ]
    const out = resolveParameters(
      { q: 'hi', limit: '25', active: 'true', from: '2026-05-01T00:00:00Z' },
      defs,
      NOW,
    )
    expect(out.get('q')).toEqual({ kind: 'string', value: 'hi' })
    expect(out.get('limit')).toEqual({ kind: 'number', value: 25 })
    expect(out.get('active')).toEqual({ kind: 'boolean', value: true })
    expect(out.get('from')).toEqual({ kind: 'date', value: '2026-05-01T00:00:00.000Z' })
  })

  test('applies defaultValue when input is missing', () => {
    const defs: ParameterDef[] = [
      { key: 'status', kind: 'string', defaultValue: 'paid' },
    ]
    const out = resolveParameters({}, defs, NOW)
    expect(out.get('status')).toEqual({ kind: 'string', value: 'paid' })
  })

  test('throws when a required parameter is missing with no default', () => {
    expect(() =>
      resolveParameters({}, [{ key: 'companyId', kind: 'fk', required: true }], NOW),
    ).toThrow(ParameterError)
  })

  test('throws on type mismatch', () => {
    expect(() =>
      resolveParameters({ limit: 'abc' }, [{ key: 'limit', kind: 'number' }], NOW),
    ).toThrow(/expected number/)
  })

  test('enum rejects values outside of options', () => {
    const defs: ParameterDef[] = [
      { key: 'status', kind: 'enum', options: ['paid', 'pending'] },
    ]
    expect(() => resolveParameters({ status: 'cancelled' }, defs, NOW)).toThrow(/allowed options/)
    const out = resolveParameters({ status: 'paid' }, defs, NOW)
    expect(out.get('status')).toEqual({ kind: 'enum', value: 'paid' })
  })

  test('date_range from token resolves to inclusive bounds', () => {
    const defs: ParameterDef[] = [{ key: 'period', kind: 'date_range' }]
    const out = resolveParameters({ period: 'last_7_days' }, defs, NOW)
    const v = out.get('period')!
    expect(v.kind).toBe('date_range')
    if (v.kind === 'date_range') {
      expect(v.token).toBe('last_7_days')
      expect(v.value.from).toBe('2026-05-09T00:00:00.000Z')
      expect(v.value.to).toBe('2026-05-15T23:59:59.999Z')
    }
  })

  test('date_range custom requires from + to inside object', () => {
    const defs: ParameterDef[] = [{ key: 'period', kind: 'date_range' }]
    expect(() => resolveParameters({ period: 'custom' }, defs, NOW)).toThrow(ParameterError)
    expect(() =>
      resolveParameters(
        { period: { token: 'custom', from: '2026-01-01T00:00:00Z' } },
        defs,
        NOW,
      ),
    ).toThrow(/from and to/)
    const out = resolveParameters(
      {
        period: {
          token: 'custom',
          from: '2026-01-01T00:00:00Z',
          to: '2026-01-31T23:59:59Z',
        },
      },
      defs,
      NOW,
    )
    const v = out.get('period')!
    expect(v.kind).toBe('date_range')
  })
})

describe('bindFiltersToParameters', () => {
  test('rewrites parameter filters to literal filters', () => {
    const filters: FilterExpr[] = [
      { kind: 'parameter', field: 'status', op: 'eq', parameter: 'status' },
    ]
    const resolved = resolveParameters(
      { status: 'paid' },
      [{ key: 'status', kind: 'string' }],
      NOW,
    )
    const bound = bindFiltersToParameters(filters, resolved, NOW)
    expect(bound).toEqual([{ kind: 'literal', field: 'status', op: 'eq', value: 'paid' }])
  })

  test('drops parameter filters when no value is supplied', () => {
    const filters: FilterExpr[] = [
      { kind: 'parameter', field: 'status', op: 'eq', parameter: 'status' },
      { kind: 'literal', field: 'flag', op: 'eq', value: true },
    ]
    const bound = bindFiltersToParameters(filters, new Map(), NOW)
    expect(bound).toEqual([{ kind: 'literal', field: 'flag', op: 'eq', value: true }])
  })

  test('expands date_range filter into gte/lte AND-group', () => {
    const filters: FilterExpr[] = [
      { kind: 'date_range', field: 'created_at', token: 'last_7_days' },
    ]
    const bound = bindFiltersToParameters(filters, new Map(), NOW)
    expect(bound).toHaveLength(1)
    const group = bound[0]
    expect(group.kind).toBe('group')
    if (group.kind === 'group') {
      expect(group.op).toBe('and')
      expect(group.children).toEqual([
        { kind: 'literal', field: 'created_at', op: 'gte', value: '2026-05-09T00:00:00.000Z' },
        { kind: 'literal', field: 'created_at', op: 'lte', value: '2026-05-15T23:59:59.999Z' },
      ])
    }
  })

  test('preserves group filters and strips empty branches', () => {
    const filters: FilterExpr[] = [
      {
        kind: 'group',
        op: 'or',
        children: [
          { kind: 'parameter', field: 'a', op: 'eq', parameter: 'missing' },
          { kind: 'literal', field: 'b', op: 'eq', value: 1 },
        ],
      },
    ]
    const bound = bindFiltersToParameters(filters, new Map(), NOW)
    expect(bound).toHaveLength(1)
    const group = bound[0]
    expect(group.kind).toBe('group')
    if (group.kind === 'group') {
      expect(group.children).toEqual([{ kind: 'literal', field: 'b', op: 'eq', value: 1 }])
    }
  })
})
