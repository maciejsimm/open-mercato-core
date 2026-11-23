import {
  computeNextRunAt,
  computeNextRunTimes,
  formatCadence,
  isValidCadence,
  isValidTimeZone,
  parseCadence,
  parseCronExpression,
  wallTimeToUtc,
  type Cadence,
} from '../lib/schedule-cadence'

function next(raw: string, nowIso: string, timezone: string): string | undefined {
  const cadence = parseCadence(raw)
  if (!cadence) throw new Error(`[internal] unparseable cadence ${raw}`)
  return computeNextRunAt(cadence, new Date(nowIso), timezone)?.toISOString()
}

function nextN(raw: string, nowIso: string, timezone: string, count: number): string[] {
  const cadence = parseCadence(raw) as Cadence
  return computeNextRunTimes(cadence, new Date(nowIso), timezone, count).map((date) => date.toISOString())
}

describe('parseCadence — legacy shapes stay valid', () => {
  test('parses single-day weekly cadences (dow kept for back-compat)', () => {
    expect(parseCadence('weekly:mon@09:00')).toEqual({ kind: 'weekly', dow: 'mon', dows: ['mon'], hour: 9, minute: 0 })
    expect(parseCadence('weekly:fri@17:30')).toEqual({ kind: 'weekly', dow: 'fri', dows: ['fri'], hour: 17, minute: 30 })
  })

  test('parses monthly cadences for valid day-of-month', () => {
    expect(parseCadence('monthly:1@09:00')).toEqual({ kind: 'monthly', day: 1, hour: 9, minute: 0 })
    expect(parseCadence('monthly:28@23:59')).toEqual({ kind: 'monthly', day: 28, hour: 23, minute: 59 })
  })

  test('rejects monthly day-of-month outside 1..28', () => {
    expect(parseCadence('monthly:29@09:00')).toBeNull()
    expect(parseCadence('monthly:0@09:00')).toBeNull()
    expect(parseCadence('monthly:31@09:00')).toBeNull()
  })

  test('rejects malformed cadence strings', () => {
    expect(parseCadence('')).toBeNull()
    expect(parseCadence('weekly:funday@09:00')).toBeNull()
    expect(parseCadence('weekly:mon@24:00')).toBeNull()
    expect(parseCadence('weekly:mon@09:60')).toBeNull()
    expect(parseCadence('weekly:@09:00')).toBeNull()
    expect(parseCadence('weekly:mon,@09:00')).toBeNull()
    expect(parseCadence('daily@9:00')).toBeNull()
    expect(parseCadence('daily:09:00')).toBeNull()
    expect(parseCadence('monthly:first@09:00')).toBeNull()
    expect(parseCadence('cron:')).toBeNull()
  })

  test('accepts cron expressions as a passthrough', () => {
    expect(parseCadence('cron:0 9 * * 1')).toEqual({ kind: 'cron', expression: '0 9 * * 1' })
  })
})

describe('parseCadence — new shapes', () => {
  test('daily', () => {
    expect(parseCadence('daily@07:15')).toEqual({ kind: 'daily', hour: 7, minute: 15 })
  })

  test('weekly with several days normalizes order and duplicates', () => {
    expect(parseCadence('weekly:wed,mon@09:00')).toEqual({ kind: 'weekly', dow: 'mon', dows: ['mon', 'wed'], hour: 9, minute: 0 })
    expect(parseCadence('weekly:sun,sat,sun@10:00')).toEqual({ kind: 'weekly', dow: 'sat', dows: ['sat', 'sun'], hour: 10, minute: 0 })
  })

  test('monthly last day', () => {
    expect(parseCadence('monthly:last@18:00')).toEqual({ kind: 'monthly', day: 'last', hour: 18, minute: 0 })
  })
})

describe('formatCadence round-trips every shape', () => {
  test.each([
    'daily@06:05',
    'weekly:mon@09:00',
    'weekly:mon,wed,fri@09:00',
    'monthly:15@12:30',
    'monthly:last@23:59',
    'cron:*/15 8-17 * * 1-5',
  ])('%s', (raw) => {
    expect(formatCadence(parseCadence(raw) as Cadence)).toBe(raw)
  })

  test('canonicalizes day order', () => {
    expect(formatCadence(parseCadence('weekly:fri,mon@09:00') as Cadence)).toBe('weekly:mon,fri@09:00')
  })
})

describe('parseCronExpression', () => {
  test('accepts standard syntax', () => {
    expect(parseCronExpression('0 9 * * 1')).not.toBeNull()
    expect(parseCronExpression('*/15 8-17 * * mon-fri')).not.toBeNull()
    expect(parseCronExpression('0 0 1,15 jan,jul *')).not.toBeNull()
    expect(parseCronExpression('0 0 * * 7')?.daysOfWeek.has(0)).toBe(true)
    expect(parseCronExpression('@daily')?.hours).toEqual([0])
  })

  test('rejects malformed or out-of-range expressions', () => {
    expect(parseCronExpression('')).toBeNull()
    expect(parseCronExpression('0 9 * *')).toBeNull()
    expect(parseCronExpression('60 9 * * *')).toBeNull()
    expect(parseCronExpression('0 24 * * *')).toBeNull()
    expect(parseCronExpression('0 9 0 * *')).toBeNull()
    expect(parseCronExpression('0 9 * 13 *')).toBeNull()
    expect(parseCronExpression('0 9 * * 8')).toBeNull()
    expect(parseCronExpression('0 9 * * 5-1')).toBeNull()
    expect(parseCronExpression('*/0 9 * * *')).toBeNull()
    expect(parseCronExpression('every day')).toBeNull()
  })

  test('isValidCadence checks the cron body', () => {
    expect(isValidCadence('cron:0 9 * * 1')).toBe(true)
    expect(isValidCadence('cron:not a cron')).toBe(false)
    expect(isValidCadence('daily@09:00')).toBe(true)
    expect(isValidCadence('weekly:mon@9:00')).toBe(false)
  })
})

describe('isValidTimeZone', () => {
  test('accepts IANA names and rejects garbage', () => {
    expect(isValidTimeZone('Europe/Warsaw')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })
})

describe('computeNextRunAt — legacy behavior preserved', () => {
  test('weekly cadence in UTC computes the next matching weekday', () => {
    expect(next('weekly:mon@09:00', '2026-05-15T08:00:00Z', 'UTC')).toBe('2026-05-18T09:00:00.000Z')
  })

  test('weekly cadence later same day pushes to next week', () => {
    expect(next('weekly:fri@09:00', '2026-05-15T12:00:00Z', 'UTC')).toBe('2026-05-22T09:00:00.000Z')
  })

  test('weekly cadence earlier same day fires today', () => {
    expect(next('weekly:fri@09:00', '2026-05-15T08:59:00Z', 'UTC')).toBe('2026-05-15T09:00:00.000Z')
  })

  test('a run exactly at the trigger instant schedules the following one', () => {
    expect(next('weekly:fri@09:00', '2026-05-15T09:00:00Z', 'UTC')).toBe('2026-05-22T09:00:00.000Z')
  })

  test('monthly cadence rolls into the next month after the trigger time has passed', () => {
    expect(next('monthly:1@09:00', '2026-05-15T12:00:00Z', 'UTC')).toBe('2026-06-01T09:00:00.000Z')
  })

  test('weekly cadence honors a non-UTC timezone offset', () => {
    expect(next('weekly:mon@09:00', '2026-05-15T08:00:00Z', 'Europe/Warsaw')).toBe('2026-05-18T07:00:00.000Z')
  })
})

describe('computeNextRunAt — daily', () => {
  test('fires later today, otherwise tomorrow', () => {
    expect(next('daily@09:00', '2026-05-15T08:00:00Z', 'UTC')).toBe('2026-05-15T09:00:00.000Z')
    expect(next('daily@09:00', '2026-05-15T10:00:00Z', 'UTC')).toBe('2026-05-16T09:00:00.000Z')
  })

  test('crosses month and year boundaries', () => {
    expect(next('daily@09:00', '2026-12-31T10:00:00Z', 'UTC')).toBe('2027-01-01T09:00:00.000Z')
  })

  test('uses the wall-clock date of the schedule timezone, not UTC', () => {
    // 2026-05-15 23:30 UTC is already 2026-05-16 08:30 in Tokyo.
    expect(next('daily@09:00', '2026-05-15T23:30:00Z', 'Asia/Tokyo')).toBe('2026-05-16T00:00:00.000Z')
    // 2026-05-16 03:00 UTC is still 2026-05-15 20:00 in Los Angeles.
    expect(next('daily@21:00', '2026-05-16T03:00:00Z', 'America/Los_Angeles')).toBe('2026-05-16T04:00:00.000Z')
  })

  test('next three runs are consecutive days', () => {
    expect(nextN('daily@09:00', '2026-05-15T10:00:00Z', 'UTC', 3)).toEqual([
      '2026-05-16T09:00:00.000Z',
      '2026-05-17T09:00:00.000Z',
      '2026-05-18T09:00:00.000Z',
    ])
  })
})

describe('computeNextRunAt — weekly with multiple days', () => {
  test('picks the nearest listed day', () => {
    // Friday 2026-05-15 → next Mon/Wed run is Monday.
    expect(next('weekly:mon,wed@09:00', '2026-05-15T08:00:00Z', 'UTC')).toBe('2026-05-18T09:00:00.000Z')
    // Monday after 09:00 → Wednesday.
    expect(next('weekly:mon,wed@09:00', '2026-05-18T10:00:00Z', 'UTC')).toBe('2026-05-20T09:00:00.000Z')
  })

  test('next runs wrap across the week boundary', () => {
    expect(nextN('weekly:mon,wed@09:00', '2026-05-19T00:00:00Z', 'Europe/Warsaw', 3)).toEqual([
      '2026-05-20T07:00:00.000Z',
      '2026-05-25T07:00:00.000Z',
      '2026-05-27T07:00:00.000Z',
    ])
  })

  test('wraps across a month boundary', () => {
    // Sat 2026-05-30 → Sun 31st → then Sat 6th June.
    expect(nextN('weekly:sat,sun@08:00', '2026-05-30T09:00:00Z', 'UTC', 2)).toEqual([
      '2026-05-31T08:00:00.000Z',
      '2026-06-06T08:00:00.000Z',
    ])
  })
})

describe('computeNextRunAt — monthly', () => {
  test('fires later this month when the day is still ahead', () => {
    expect(next('monthly:20@09:00', '2026-05-15T12:00:00Z', 'UTC')).toBe('2026-05-20T09:00:00.000Z')
  })

  test('crosses the year boundary', () => {
    expect(next('monthly:1@09:00', '2026-12-01T10:00:00Z', 'UTC')).toBe('2027-01-01T09:00:00.000Z')
  })

  test('last day follows month length including leap years', () => {
    expect(nextN('monthly:last@18:00', '2027-12-31T19:00:00Z', 'UTC', 3)).toEqual([
      '2028-01-31T18:00:00.000Z',
      '2028-02-29T18:00:00.000Z',
      '2028-03-31T18:00:00.000Z',
    ])
    expect(next('monthly:last@18:00', '2026-02-10T00:00:00Z', 'UTC')).toBe('2026-02-28T18:00:00.000Z')
    expect(next('monthly:last@18:00', '2026-04-30T17:00:00Z', 'UTC')).toBe('2026-04-30T18:00:00.000Z')
  })

  test('last day in a timezone ahead of UTC', () => {
    // 2026-04-30 23:30 Warsaw (21:30Z) — the April last-day run at 23:00 has passed.
    expect(next('monthly:last@23:00', '2026-04-30T21:30:00Z', 'Europe/Warsaw')).toBe('2026-05-31T21:00:00.000Z')
  })
})

describe('computeNextRunAt — DST', () => {
  test('keeps the wall-clock time across the spring-forward transition (Europe/Warsaw)', () => {
    // DST starts 2026-03-29 in Europe: 09:00 is UTC+1 before, UTC+2 after.
    expect(nextN('daily@09:00', '2026-03-27T12:00:00Z', 'Europe/Warsaw', 3)).toEqual([
      '2026-03-28T08:00:00.000Z',
      '2026-03-29T07:00:00.000Z',
      '2026-03-30T07:00:00.000Z',
    ])
  })

  test('keeps the wall-clock time across the fall-back transition (Europe/Warsaw)', () => {
    // DST ends 2026-10-25.
    expect(nextN('weekly:sat,sun,mon@09:00', '2026-10-23T12:00:00Z', 'Europe/Warsaw', 3)).toEqual([
      '2026-10-24T07:00:00.000Z',
      '2026-10-25T08:00:00.000Z',
      '2026-10-26T08:00:00.000Z',
    ])
  })

  test('a time inside the spring-forward gap fires right after the gap', () => {
    // 02:30 does not exist in Warsaw on 2026-03-29; it fires at 03:30 local (01:30Z).
    expect(next('daily@02:30', '2026-03-28T12:00:00Z', 'Europe/Warsaw')).toBe('2026-03-29T01:30:00.000Z')
  })

  test('an ambiguous fall-back time fires once, on its first occurrence', () => {
    // 02:30 happens twice in Warsaw on 2026-10-25 (00:30Z and 01:30Z).
    expect(nextN('daily@02:30', '2026-10-24T12:00:00Z', 'Europe/Warsaw', 2)).toEqual([
      '2026-10-25T00:30:00.000Z',
      '2026-10-26T01:30:00.000Z',
    ])
  })

  test('US transition (America/New_York) on a monthly cadence', () => {
    // DST starts 2026-03-08 in the US: 09:00 EST = 14:00Z, 09:00 EDT = 13:00Z.
    expect(nextN('monthly:1@09:00', '2026-02-15T00:00:00Z', 'America/New_York', 2)).toEqual([
      '2026-03-01T14:00:00.000Z',
      '2026-04-01T13:00:00.000Z',
    ])
  })

  test('wallTimeToUtc projects plain times with the local offset', () => {
    expect(wallTimeToUtc(Date.UTC(2026, 6, 1, 9, 0), 'Europe/Warsaw').toISOString()).toBe('2026-07-01T07:00:00.000Z')
    expect(wallTimeToUtc(Date.UTC(2026, 0, 1, 9, 0), 'Europe/Warsaw').toISOString()).toBe('2026-01-01T08:00:00.000Z')
  })
})

describe('computeNextRunAt — cron', () => {
  test('evaluates cron expressions in the schedule timezone', () => {
    expect(next('cron:0 9 * * 1', '2026-05-15T08:00:00Z', 'UTC')).toBe('2026-05-18T09:00:00.000Z')
    expect(next('cron:0 9 * * 1', '2026-05-15T08:00:00Z', 'Europe/Warsaw')).toBe('2026-05-18T07:00:00.000Z')
  })

  test('handles steps and ranges within a day', () => {
    expect(nextN('cron:*/15 9-10 * * *', '2026-05-15T10:40:00Z', 'UTC', 3)).toEqual([
      '2026-05-15T10:45:00.000Z',
      '2026-05-16T09:00:00.000Z',
      '2026-05-16T09:15:00.000Z',
    ])
  })

  test('day-of-month and day-of-week are OR-ed when both are restricted', () => {
    // The 1st of the month OR any Friday.
    expect(nextN('cron:0 12 1 * 5', '2026-05-27T00:00:00Z', 'UTC', 3)).toEqual([
      '2026-05-29T12:00:00.000Z',
      '2026-06-01T12:00:00.000Z',
      '2026-06-05T12:00:00.000Z',
    ])
  })

  test('rare dates are found (Feb 29)', () => {
    expect(next('cron:0 0 29 2 *', '2026-03-01T00:00:00Z', 'UTC')).toBe('2028-02-29T00:00:00.000Z')
  })

  test('returns null for malformed cron expressions', () => {
    const cadence = parseCadence('cron:not a cron') as Cadence
    expect(computeNextRunAt(cadence, new Date('2026-05-15T08:00:00Z'), 'UTC')).toBeNull()
  })

  test('every-minute cron returns the next minute', () => {
    expect(next('cron:* * * * *', '2026-05-15T08:00:30Z', 'UTC')).toBe('2026-05-15T08:01:00.000Z')
  })
})
