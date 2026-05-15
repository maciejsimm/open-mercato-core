import { DATE_RANGE_TOKENS, isDateRangeToken, resolveDateRange } from '../lib/date-ranges'

const NOW = new Date(Date.UTC(2026, 4, 15, 14, 22, 33, 444)) // 2026-05-15T14:22:33.444Z (Fri)

describe('date-ranges', () => {
  test('exports all 12 tokens', () => {
    expect(DATE_RANGE_TOKENS).toHaveLength(12)
  })

  test('today is full UTC day', () => {
    const r = resolveDateRange('today', NOW)
    expect(r.from).toBe('2026-05-15T00:00:00.000Z')
    expect(r.to).toBe('2026-05-15T23:59:59.999Z')
  })

  test('yesterday is full UTC day prior', () => {
    const r = resolveDateRange('yesterday', NOW)
    expect(r.from).toBe('2026-05-14T00:00:00.000Z')
    expect(r.to).toBe('2026-05-14T23:59:59.999Z')
  })

  test('last_24h rolls back 24h from now exactly', () => {
    const r = resolveDateRange('last_24h', NOW)
    expect(r.from).toBe('2026-05-14T14:22:33.444Z')
    expect(r.to).toBe('2026-05-15T14:22:33.444Z')
  })

  test('last_7_days is 6 days of starts back through end of today', () => {
    const r = resolveDateRange('last_7_days', NOW)
    expect(r.from).toBe('2026-05-09T00:00:00.000Z')
    expect(r.to).toBe('2026-05-15T23:59:59.999Z')
  })

  test('last_30_days', () => {
    const r = resolveDateRange('last_30_days', NOW)
    expect(r.from).toBe('2026-04-16T00:00:00.000Z')
    expect(r.to).toBe('2026-05-15T23:59:59.999Z')
  })

  test('mtd starts at first of month', () => {
    const r = resolveDateRange('mtd', NOW)
    expect(r.from).toBe('2026-05-01T00:00:00.000Z')
    expect(r.to).toBe('2026-05-15T23:59:59.999Z')
  })

  test('last_month spans previous month entirely', () => {
    const r = resolveDateRange('last_month', NOW)
    expect(r.from).toBe('2026-04-01T00:00:00.000Z')
    expect(r.to).toBe('2026-04-30T23:59:59.999Z')
  })

  test('qtd starts at first of quarter (Apr-Jun for May)', () => {
    const r = resolveDateRange('qtd', NOW)
    expect(r.from).toBe('2026-04-01T00:00:00.000Z')
    expect(r.to).toBe('2026-05-15T23:59:59.999Z')
  })

  test('last_quarter spans Jan-Mar for a Q2 date', () => {
    const r = resolveDateRange('last_quarter', NOW)
    expect(r.from).toBe('2026-01-01T00:00:00.000Z')
    expect(r.to).toBe('2026-03-31T23:59:59.999Z')
  })

  test('ytd starts Jan 1', () => {
    const r = resolveDateRange('ytd', NOW)
    expect(r.from).toBe('2026-01-01T00:00:00.000Z')
    expect(r.to).toBe('2026-05-15T23:59:59.999Z')
  })

  test('last_year spans previous calendar year', () => {
    const r = resolveDateRange('last_year', NOW)
    expect(r.from).toBe('2025-01-01T00:00:00.000Z')
    expect(r.to).toBe('2025-12-31T23:59:59.999Z')
  })

  test('custom requires both from and to', () => {
    expect(() => resolveDateRange('custom', NOW)).toThrow(/from and to/)
    expect(() => resolveDateRange('custom', NOW, { from: '2026-01-01T00:00:00Z' })).toThrow(
      /from and to/,
    )
    const r = resolveDateRange('custom', NOW, {
      from: '2026-01-01T00:00:00Z',
      to: '2026-01-31T23:59:59Z',
    })
    expect(r).toEqual({ from: '2026-01-01T00:00:00Z', to: '2026-01-31T23:59:59Z' })
  })

  test('isDateRangeToken accepts known tokens and rejects unknown', () => {
    expect(isDateRangeToken('today')).toBe(true)
    expect(isDateRangeToken('custom')).toBe(true)
    expect(isDateRangeToken('forever')).toBe(false)
    expect(isDateRangeToken(42)).toBe(false)
  })
})
