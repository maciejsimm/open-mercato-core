import type { DateRangeToken } from '@open-mercato/shared/modules/reports/dsl'

export type DateRange = { from: string; to: string }

export const DATE_RANGE_TOKENS: DateRangeToken[] = [
  'today',
  'yesterday',
  'last_24h',
  'last_7_days',
  'last_30_days',
  'mtd',
  'last_month',
  'qtd',
  'last_quarter',
  'ytd',
  'last_year',
  'custom',
]

function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0))
}
function endOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999))
}
function addDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000)
}
function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0))
}
function endOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999))
}
function startOfQuarterUtc(d: Date): Date {
  const q = Math.floor(d.getUTCMonth() / 3)
  return new Date(Date.UTC(d.getUTCFullYear(), q * 3, 1, 0, 0, 0, 0))
}
function endOfQuarterUtc(d: Date): Date {
  const q = Math.floor(d.getUTCMonth() / 3)
  return new Date(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 0, 23, 59, 59, 999))
}
function startOfYearUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1, 0, 0, 0, 0))
}
function endOfYearUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), 11, 31, 23, 59, 59, 999))
}

function iso(d: Date): string {
  return d.toISOString()
}

/**
 * Resolve a date-range token into concrete inclusive UTC bounds.
 * `custom` returns `{ from, to }` as provided; if either is missing the
 * caller is expected to supply both.
 */
export function resolveDateRange(
  token: DateRangeToken,
  now: Date = new Date(),
  custom?: { from?: string; to?: string },
): DateRange {
  switch (token) {
    case 'today': {
      return { from: iso(startOfDayUtc(now)), to: iso(endOfDayUtc(now)) }
    }
    case 'yesterday': {
      const y = addDaysUtc(now, -1)
      return { from: iso(startOfDayUtc(y)), to: iso(endOfDayUtc(y)) }
    }
    case 'last_24h': {
      return { from: iso(new Date(now.getTime() - 24 * 60 * 60 * 1000)), to: iso(now) }
    }
    case 'last_7_days': {
      return { from: iso(startOfDayUtc(addDaysUtc(now, -6))), to: iso(endOfDayUtc(now)) }
    }
    case 'last_30_days': {
      return { from: iso(startOfDayUtc(addDaysUtc(now, -29))), to: iso(endOfDayUtc(now)) }
    }
    case 'mtd': {
      return { from: iso(startOfMonthUtc(now)), to: iso(endOfDayUtc(now)) }
    }
    case 'last_month': {
      const lm = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
      return { from: iso(startOfMonthUtc(lm)), to: iso(endOfMonthUtc(lm)) }
    }
    case 'qtd': {
      return { from: iso(startOfQuarterUtc(now)), to: iso(endOfDayUtc(now)) }
    }
    case 'last_quarter': {
      const lqStart = new Date(startOfQuarterUtc(now).getTime())
      lqStart.setUTCMonth(lqStart.getUTCMonth() - 3)
      return { from: iso(startOfQuarterUtc(lqStart)), to: iso(endOfQuarterUtc(lqStart)) }
    }
    case 'ytd': {
      return { from: iso(startOfYearUtc(now)), to: iso(endOfDayUtc(now)) }
    }
    case 'last_year': {
      const ly = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1))
      return { from: iso(startOfYearUtc(ly)), to: iso(endOfYearUtc(ly)) }
    }
    case 'custom': {
      const from = custom?.from
      const to = custom?.to
      if (!from || !to) {
        throw new Error(`Date range 'custom' requires both from and to`)
      }
      return { from, to }
    }
  }
}

export function isDateRangeToken(value: unknown): value is DateRangeToken {
  return typeof value === 'string' && (DATE_RANGE_TOKENS as string[]).includes(value)
}
