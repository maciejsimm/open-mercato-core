import { formatReportValue, NULL_DISPLAY } from '../lib/format'

const translate = (key: string, fallback: string) =>
  ({ 'reports.format.yes': 'Ja', 'reports.format.no': 'Nein', 'x.open': 'Offen' } as Record<string, string>)[key] ?? fallback

describe('formatReportValue', () => {
  test('null / undefined / empty render as an em dash', () => {
    expect(formatReportValue(null, { key: 'a', kind: 'text' }, { locale: 'en' })).toBe(NULL_DISPLAY)
    expect(formatReportValue(undefined, undefined, { locale: 'en' })).toBe(NULL_DISPLAY)
  })

  test('integer and float use locale separators; floats default to 2 decimals', () => {
    expect(formatReportValue(1234567, { key: 'a', kind: 'integer' }, { locale: 'en' })).toBe('1,234,567')
    expect(formatReportValue(1234567, { key: 'a', kind: 'integer' }, { locale: 'de' })).toBe('1.234.567')
    expect(formatReportValue(1234.5, { key: 'a', kind: 'float' }, { locale: 'en' })).toBe('1,234.50')
    expect(formatReportValue(12345.5, { key: 'a', kind: 'float' }, { locale: 'pl' })).toMatch(/^12\s345,50$/)
  })

  test('format overrides: precision, percent, compact', () => {
    expect(formatReportValue(0.256, { key: 'a', kind: 'float', format: { percent: true, precision: 1 } }, { locale: 'en' })).toBe('25.6%')
    expect(formatReportValue(12345, { key: 'a', kind: 'integer' }, { locale: 'en', override: { compact: true } })).toBe('12.3K')
  })

  test('money uses the row currency and exact decimal strings', () => {
    const column = { key: 'total', kind: 'money' as const, currencyField: 'currency' }
    expect(formatReportValue('1234.5', column, { locale: 'en', row: { currency: 'USD' } })).toBe('$1,234.50')
    expect(formatReportValue(1234.5, column, { locale: 'de', row: { currency: 'EUR' } })).toMatch(/^1\.234,50\s€$/)
    expect(formatReportValue(1000, { key: 't', kind: 'money', currency: 'JPY' }, { locale: 'en' })).toBe('¥1,000')
    expect(formatReportValue(5, { key: 't', kind: 'money' }, { locale: 'en' })).toBe('5.00')
  })

  test('date renders without timezone shift; datetime honours the viewer zone', () => {
    expect(formatReportValue('2026-03-01', { key: 'd', kind: 'date' }, { locale: 'en', timeZone: 'America/Los_Angeles' })).toBe('Mar 1, 2026')
    const iso = '2026-03-01T23:30:00.000Z'
    expect(formatReportValue(iso, { key: 'd', kind: 'datetime' }, { locale: 'en', timeZone: 'UTC' })).toContain('Mar 1, 2026')
    expect(formatReportValue(iso, { key: 'd', kind: 'datetime' }, { locale: 'en', timeZone: 'Europe/Warsaw' })).toContain('Mar 2, 2026')
  })

  test('boolean and enum use translated labels; fk falls back to the id', () => {
    expect(formatReportValue(true, { key: 'b', kind: 'boolean' }, { locale: 'de', translate })).toBe('Ja')
    expect(formatReportValue(false, { key: 'b', kind: 'boolean' }, { locale: 'de', translate })).toBe('Nein')
    const enumColumn = { key: 's', kind: 'enum' as const, options: [{ value: 'open', labelKey: 'x.open' }] }
    expect(formatReportValue('open', enumColumn, { locale: 'de', translate })).toBe('Offen')
    expect(formatReportValue('closed', enumColumn, { locale: 'de', translate })).toBe('closed')
    expect(formatReportValue('uuid-1', { key: 'f', kind: 'fk' }, { locale: 'en', fkLabels: { 'uuid-1': 'Acme' } })).toBe('Acme')
    expect(formatReportValue('uuid-2', { key: 'f', kind: 'fk' }, { locale: 'en' })).toBe('uuid-2')
  })
})
