import { computeNextRunAt, parseCadence } from '../lib/schedule-cadence'

describe('parseCadence', () => {
  test('parses weekly cadences', () => {
    expect(parseCadence('weekly:mon@09:00')).toEqual({ kind: 'weekly', dow: 'mon', hour: 9, minute: 0 })
    expect(parseCadence('weekly:fri@17:30')).toEqual({ kind: 'weekly', dow: 'fri', hour: 17, minute: 30 })
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
  })

  test('accepts cron expressions as a passthrough', () => {
    expect(parseCadence('cron:0 9 * * 1')).toEqual({ kind: 'cron', expression: '0 9 * * 1' })
  })
})

describe('computeNextRunAt', () => {
  test('returns null for cron cadences (workers evaluate them via a dedicated lib)', () => {
    const cron = parseCadence('cron:0 9 * * 1')!
    expect(computeNextRunAt(cron, new Date('2026-05-15T08:00:00Z'), 'UTC')).toBeNull()
  })

  test('weekly cadence in UTC computes the next matching weekday', () => {
    const cadence = parseCadence('weekly:mon@09:00')!
    // Friday 2026-05-15 in UTC → next Monday at 09:00 UTC.
    const next = computeNextRunAt(cadence, new Date('2026-05-15T08:00:00Z'), 'UTC')
    expect(next?.toISOString()).toBe('2026-05-18T09:00:00.000Z')
  })

  test('weekly cadence later same day pushes to next week', () => {
    const cadence = parseCadence('weekly:fri@09:00')!
    // Friday 2026-05-15 12:00 UTC → next firing is the following Friday.
    const next = computeNextRunAt(cadence, new Date('2026-05-15T12:00:00Z'), 'UTC')
    expect(next?.toISOString()).toBe('2026-05-22T09:00:00.000Z')
  })

  test('monthly cadence rolls into the next month after the trigger time has passed', () => {
    const cadence = parseCadence('monthly:1@09:00')!
    // 2026-05-15 12:00 UTC → next firing is 2026-06-01 09:00 UTC.
    const next = computeNextRunAt(cadence, new Date('2026-05-15T12:00:00Z'), 'UTC')
    expect(next?.toISOString()).toBe('2026-06-01T09:00:00.000Z')
  })

  test('weekly cadence honors a non-UTC timezone offset', () => {
    const cadence = parseCadence('weekly:mon@09:00')!
    // Europe/Warsaw is UTC+2 in May. Next Monday 09:00 Warsaw = 07:00 UTC.
    const next = computeNextRunAt(cadence, new Date('2026-05-15T08:00:00Z'), 'Europe/Warsaw')
    expect(next?.toISOString()).toBe('2026-05-18T07:00:00.000Z')
  })
})
