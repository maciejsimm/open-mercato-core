/**
 * Cadence helpers for `reports_schedules.cadence`.
 *
 * The MVP supports three cadence shapes:
 *  - `weekly:<dow>@<HH:MM>`   — fires once a week at the named day/hour.
 *  - `monthly:<day>@<HH:MM>`  — fires once a month at the named day-of-month/hour.
 *  - `cron:<expression>`      — free-form cron expression evaluated by the worker.
 *
 * `parseCadence` returns a typed descriptor; the workers (Step 4.2) use it to
 * compute `next_run_at`. `computeNextRunAt` returns the next UTC instant the
 * schedule should fire after `now`. Timezone offsets are applied as a constant
 * minute offset (the validators accept any IANA name; only Phase 5 polishes
 * around DST shifts).
 */

export type WeeklyCadence = {
  kind: 'weekly'
  dow: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
  hour: number
  minute: number
}

export type MonthlyCadence = {
  kind: 'monthly'
  day: number
  hour: number
  minute: number
}

export type CronCadence = {
  kind: 'cron'
  expression: string
}

export type Cadence = WeeklyCadence | MonthlyCadence | CronCadence

const DOW_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

const weeklyPattern = /^weekly:(mon|tue|wed|thu|fri|sat|sun)@(\d{2}):(\d{2})$/
const monthlyPattern = /^monthly:(\d{1,2})@(\d{2}):(\d{2})$/
const cronPattern = /^cron:(.+)$/

export function parseCadence(raw: string): Cadence | null {
  const weekly = weeklyPattern.exec(raw)
  if (weekly) {
    const [, dow, hh, mm] = weekly
    const hour = Number(hh)
    const minute = Number(mm)
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
    if (hour > 23 || minute > 59) return null
    return { kind: 'weekly', dow: dow as WeeklyCadence['dow'], hour, minute }
  }
  const monthly = monthlyPattern.exec(raw)
  if (monthly) {
    const [, dayRaw, hh, mm] = monthly
    const day = Number(dayRaw)
    const hour = Number(hh)
    const minute = Number(mm)
    if (!Number.isFinite(day) || day < 1 || day > 28) return null
    if (hour > 23 || minute > 59) return null
    return { kind: 'monthly', day, hour, minute }
  }
  const cron = cronPattern.exec(raw)
  if (cron) {
    return { kind: 'cron', expression: cron[1] }
  }
  return null
}

/**
 * Compute the next UTC instant a schedule should fire after `now`. For `weekly`
 * and `monthly` cadences the calculation honors the named timezone via the
 * intl `formatToParts` API. For `cron`, we return `null` — the worker (Step 4.2)
 * is expected to evaluate cron expressions through a dedicated dependency.
 */
export function computeNextRunAt(cadence: Cadence, now: Date, timezone: string): Date | null {
  if (cadence.kind === 'cron') return null
  // Translate `now` to wall-clock in the target timezone.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? '0')
  const yr = part('year')
  const mo = part('month')
  const dy = part('day')
  const hr = part('hour')
  const mn = part('minute')
  const sc = part('second')

  if (cadence.kind === 'weekly') {
    const wallNow = new Date(Date.UTC(yr, mo - 1, dy, hr, mn, sc))
    const targetDow = DOW_ORDER.indexOf(cadence.dow)
    const wallDow = wallNow.getUTCDay()
    let dayDelta = (targetDow - wallDow + 7) % 7
    // If today is the target day but the time has already passed, push to next week.
    if (dayDelta === 0 && (hr > cadence.hour || (hr === cadence.hour && mn >= cadence.minute))) {
      dayDelta = 7
    }
    const candidate = new Date(Date.UTC(yr, mo - 1, dy + dayDelta, cadence.hour, cadence.minute, 0))
    return projectToUtc(candidate, timezone)
  }
  // monthly
  let candYear = yr
  let candMonth = mo - 1
  if (dy > cadence.day || (dy === cadence.day && (hr > cadence.hour || (hr === cadence.hour && mn >= cadence.minute)))) {
    candMonth += 1
    if (candMonth > 11) { candMonth = 0; candYear += 1 }
  }
  const candidate = new Date(Date.UTC(candYear, candMonth, cadence.day, cadence.hour, cadence.minute, 0))
  return projectToUtc(candidate, timezone)
}

/**
 * `wallTime` is the wall-clock instant in the target timezone interpreted as
 * UTC. Translate it back to a real UTC `Date` by subtracting the timezone
 * offset at that wall instant.
 */
function projectToUtc(wallTime: Date, timezone: string): Date {
  const offsetMinutes = getTimezoneOffsetMinutes(wallTime, timezone)
  return new Date(wallTime.getTime() - offsetMinutes * 60_000)
}

function getTimezoneOffsetMinutes(at: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(at)
  const find = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  const yr = find('year')
  const mo = find('month')
  const dy = find('day')
  const hr = find('hour')
  const mn = find('minute')
  const sc = find('second')
  const wall = Date.UTC(yr, mo - 1, dy, hr, mn, sc)
  return (wall - at.getTime()) / 60_000
}
