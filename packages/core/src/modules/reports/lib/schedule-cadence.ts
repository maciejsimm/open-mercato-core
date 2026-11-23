/**
 * Cadence helpers for `reports_schedules.cadence`.
 *
 * Supported cadence shapes (all stored values from earlier releases stay valid):
 *  - `daily@<HH:MM>`                 — fires every day at the given wall-clock time.
 *  - `weekly:<dow>@<HH:MM>`          — fires once a week on the named day.
 *  - `weekly:<dow>,<dow>…@<HH:MM>`   — fires on every listed day of the week.
 *  - `monthly:<1..28>@<HH:MM>`       — fires once a month on the given day.
 *  - `monthly:last@<HH:MM>`          — fires on the last day of every month.
 *  - `cron:<expression>`             — standard 5-field cron (minute hour day-of-month month day-of-week),
 *                                      plus the `@hourly|@daily|@weekly|@monthly|@yearly` macros.
 *
 * All times are wall-clock times in the schedule's IANA timezone. Next-run
 * computation walks wall-clock days in that timezone and projects each
 * candidate back to UTC, so DST transitions are honored: a time that falls in a
 * spring-forward gap fires right after the gap, and a time that occurs twice on
 * a fall-back day fires on its first occurrence.
 */

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export type DailyCadence = {
  kind: 'daily'
  hour: number
  minute: number
}

export type WeeklyCadence = {
  kind: 'weekly'
  /** First day in `dows` (Mon→Sun order); kept for single-day callers. */
  dow: DayOfWeek
  dows: DayOfWeek[]
  hour: number
  minute: number
}

export type MonthlyCadence = {
  kind: 'monthly'
  day: number | 'last'
  hour: number
  minute: number
}

export type CronCadence = {
  kind: 'cron'
  expression: string
}

export type Cadence = DailyCadence | WeeklyCadence | MonthlyCadence | CronCadence

export type CronSpec = {
  minutes: number[]
  hours: number[]
  daysOfMonth: Set<number>
  months: Set<number>
  daysOfWeek: Set<number>
  domRestricted: boolean
  dowRestricted: boolean
}

export const DAYS_OF_WEEK: readonly DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export const MAX_MONTHLY_DAY = 28

const SUNDAY_FIRST: readonly DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MAX_SEARCH_DAYS = 366 * 8
const DAY_MS = 86_400_000
const MAX_OFFSET_MS = 14 * 3_600_000

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/
const dailyPattern = /^daily@(\d{2}:\d{2})$/
const weeklyPattern = /^weekly:((?:mon|tue|wed|thu|fri|sat|sun)(?:,(?:mon|tue|wed|thu|fri|sat|sun))*)@(\d{2}:\d{2})$/
const monthlyPattern = /^monthly:(\d{1,2}|last)@(\d{2}:\d{2})$/
const cronPattern = /^cron:(.+)$/

function parseTime(raw: string): { hour: number; minute: number } | null {
  const match = timePattern.exec(raw)
  if (!match) return null
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

export function sortDaysOfWeek(days: readonly DayOfWeek[]): DayOfWeek[] {
  return DAYS_OF_WEEK.filter((day) => days.includes(day))
}

export function parseCadence(raw: string): Cadence | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  const daily = dailyPattern.exec(value)
  if (daily) {
    const time = parseTime(daily[1])
    return time ? { kind: 'daily', ...time } : null
  }
  const weekly = weeklyPattern.exec(value)
  if (weekly) {
    const time = parseTime(weekly[2])
    if (!time) return null
    const dows = sortDaysOfWeek(weekly[1].split(',') as DayOfWeek[])
    return { kind: 'weekly', dow: dows[0], dows, ...time }
  }
  const monthly = monthlyPattern.exec(value)
  if (monthly) {
    const time = parseTime(monthly[2])
    if (!time) return null
    if (monthly[1] === 'last') return { kind: 'monthly', day: 'last', ...time }
    const day = Number(monthly[1])
    if (!Number.isInteger(day) || day < 1 || day > MAX_MONTHLY_DAY) return null
    return { kind: 'monthly', day, ...time }
  }
  const cron = cronPattern.exec(value)
  if (cron) {
    const expression = cron[1].trim()
    if (!expression) return null
    return { kind: 'cron', expression }
  }
  return null
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** Serialize a cadence back to its canonical stored string. */
export function formatCadence(cadence: Cadence): string {
  switch (cadence.kind) {
    case 'daily':
      return `daily@${formatTime(cadence.hour, cadence.minute)}`
    case 'weekly': {
      const dows = sortDaysOfWeek(cadence.dows.length ? cadence.dows : [cadence.dow])
      return `weekly:${dows.join(',')}@${formatTime(cadence.hour, cadence.minute)}`
    }
    case 'monthly':
      return `monthly:${cadence.day}@${formatTime(cadence.hour, cadence.minute)}`
    case 'cron':
      return `cron:${cadence.expression}`
  }
}

// ---------- Cron ----------

const CRON_MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

type CronFieldBounds = { min: number; max: number; names?: readonly string[]; namesOffset?: number }

const CRON_FIELDS: readonly CronFieldBounds[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12, names: MONTH_NAMES, namesOffset: 1 },
  { min: 0, max: 7, names: SUNDAY_FIRST, namesOffset: 0 },
]

function parseCronAtom(raw: string, bounds: CronFieldBounds): number | null {
  const lower = raw.toLowerCase()
  if (bounds.names) {
    const index = bounds.names.indexOf(lower)
    if (index >= 0) return index + (bounds.namesOffset ?? 0)
  }
  if (!/^\d{1,2}$/.test(lower)) return null
  const value = Number(lower)
  return value >= bounds.min && value <= bounds.max ? value : null
}

function parseCronField(raw: string, bounds: CronFieldBounds): { values: Set<number>; restricted: boolean } | null {
  const values = new Set<number>()
  let restricted = true
  for (const part of raw.split(',')) {
    if (!part) return null
    const [rangeRaw, stepRaw, ...extra] = part.split('/')
    if (extra.length) return null
    let step = 1
    if (stepRaw !== undefined) {
      if (!/^\d{1,2}$/.test(stepRaw)) return null
      step = Number(stepRaw)
      if (step < 1) return null
    }
    let start: number
    let end: number
    if (rangeRaw === '*') {
      start = bounds.min
      end = bounds.max
      if (raw.startsWith('*')) restricted = false
    } else if (rangeRaw.includes('-')) {
      const [startRaw, endRaw, ...rest] = rangeRaw.split('-')
      if (rest.length) return null
      const parsedStart = parseCronAtom(startRaw, bounds)
      const parsedEnd = parseCronAtom(endRaw, bounds)
      if (parsedStart === null || parsedEnd === null || parsedStart > parsedEnd) return null
      start = parsedStart
      end = parsedEnd
    } else {
      const single = parseCronAtom(rangeRaw, bounds)
      if (single === null) return null
      start = single
      end = stepRaw === undefined ? single : bounds.max
    }
    for (let value = start; value <= end; value += step) values.add(value)
  }
  return values.size ? { values, restricted } : null
}

/**
 * Parse a standard 5-field cron expression (or a `@macro`). Returns `null`
 * when the expression is malformed or out of range.
 */
export function parseCronExpression(expression: string): CronSpec | null {
  if (typeof expression !== 'string') return null
  const trimmed = expression.trim().toLowerCase()
  const normalized = CRON_MACROS[trimmed] ?? trimmed
  const fields = normalized.split(/\s+/)
  if (fields.length !== 5) return null
  const parsed = fields.map((field, index) => parseCronField(field, CRON_FIELDS[index]))
  if (parsed.some((field) => field === null)) return null
  const [minutes, hours, dom, months, dow] = parsed as Array<{ values: Set<number>; restricted: boolean }>
  const daysOfWeek = new Set<number>()
  for (const value of dow.values) daysOfWeek.add(value === 7 ? 0 : value)
  return {
    minutes: [...minutes.values].sort((a, b) => a - b),
    hours: [...hours.values].sort((a, b) => a - b),
    daysOfMonth: dom.values,
    months: months.values,
    daysOfWeek,
    domRestricted: dom.restricted,
    dowRestricted: dow.restricted,
  }
}

function cronMatchesDay(spec: CronSpec, year: number, month: number, day: number): boolean {
  if (!spec.months.has(month)) return false
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  const domMatch = spec.daysOfMonth.has(day)
  const dowMatch = spec.daysOfWeek.has(weekday)
  if (spec.domRestricted && spec.dowRestricted) return domMatch || dowMatch
  if (spec.domRestricted) return domMatch
  if (spec.dowRestricted) return dowMatch
  return true
}

// ---------- Timezones ----------

export function isValidTimeZone(timezone: string): boolean {
  if (typeof timezone !== 'string' || !timezone.trim()) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function getFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    })
    formatterCache.set(timezone, formatter)
  }
  return formatter
}

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number }

function toWallClock(at: Date, timezone: string): WallClock {
  const parts = getFormatter(timezone).formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? '0')
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour') % 24,
    minute: part('minute'),
    second: part('second'),
  }
}

function offsetMinutesAt(utcMs: number, timezone: string): number {
  const wall = toWallClock(new Date(utcMs), timezone)
  const wallMs = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
  return Math.round((wallMs - Math.floor(utcMs / 1000) * 1000) / 60_000)
}

/**
 * Project a wall-clock instant (expressed as UTC milliseconds) in `timezone`
 * to the real UTC instant. Ambiguous (fall-back) times resolve to their first
 * occurrence; non-existent (spring-forward) times shift forward by the gap.
 */
export function wallTimeToUtc(wallMs: number, timezone: string): Date {
  const offsetBefore = offsetMinutesAt(wallMs - DAY_MS, timezone)
  const offsetAfter = offsetMinutesAt(wallMs + DAY_MS, timezone)
  const candidates = [...new Set([offsetBefore, offsetAfter])]
    .map((offset) => wallMs - offset * 60_000)
    .filter((utcMs) => {
      const wall = toWallClock(new Date(utcMs), timezone)
      return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) === wallMs
    })
  if (candidates.length) return new Date(Math.min(...candidates))
  return new Date(wallMs - offsetBefore * 60_000)
}

// ---------- Next run ----------

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function timesForDay(cadence: Cadence, cronSpec: CronSpec | null, year: number, month: number, day: number): Array<[number, number]> {
  switch (cadence.kind) {
    case 'daily':
      return [[cadence.hour, cadence.minute]]
    case 'weekly': {
      const weekday = SUNDAY_FIRST[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
      const dows = cadence.dows.length ? cadence.dows : [cadence.dow]
      return dows.includes(weekday) ? [[cadence.hour, cadence.minute]] : []
    }
    case 'monthly': {
      const target = cadence.day === 'last' ? lastDayOfMonth(year, month) : cadence.day
      return day === target ? [[cadence.hour, cadence.minute]] : []
    }
    case 'cron': {
      if (!cronSpec || !cronMatchesDay(cronSpec, year, month, day)) return []
      const out: Array<[number, number]> = []
      for (const hour of cronSpec.hours) for (const minute of cronSpec.minutes) out.push([hour, minute])
      return out
    }
  }
}

/**
 * Compute the next UTC instant (strictly after `now`) a schedule should fire,
 * honoring the named IANA timezone. Returns `null` for malformed cron
 * expressions or when no run exists within the search horizon.
 */
export function computeNextRunAt(cadence: Cadence, now: Date, timezone: string): Date | null {
  const cronSpec = cadence.kind === 'cron' ? parseCronExpression(cadence.expression) : null
  if (cadence.kind === 'cron' && !cronSpec) return null
  const nowMs = now.getTime()
  const start = toWallClock(new Date(nowMs - DAY_MS), timezone)
  const startDayMs = Date.UTC(start.year, start.month - 1, start.day)
  for (let offset = 0; offset <= MAX_SEARCH_DAYS; offset += 1) {
    const dayDate = new Date(startDayMs + offset * DAY_MS)
    const year = dayDate.getUTCFullYear()
    const month = dayDate.getUTCMonth() + 1
    const day = dayDate.getUTCDate()
    if (dayDate.getTime() + DAY_MS + MAX_OFFSET_MS <= nowMs) continue
    for (const [hour, minute] of timesForDay(cadence, cronSpec, year, month, day)) {
      const wallMs = Date.UTC(year, month - 1, day, hour, minute, 0)
      if (wallMs + MAX_OFFSET_MS <= nowMs) continue
      const candidate = wallTimeToUtc(wallMs, timezone)
      if (candidate.getTime() > nowMs) return candidate
    }
  }
  return null
}

/** Compute the next `count` run instants after `now` (used for UI previews). */
export function computeNextRunTimes(cadence: Cadence, now: Date, timezone: string, count: number): Date[] {
  const out: Date[] = []
  let cursor = now
  for (let index = 0; index < count; index += 1) {
    const next = computeNextRunAt(cadence, cursor, timezone)
    if (!next) break
    out.push(next)
    cursor = next
  }
  return out
}

/** True when `raw` is a cadence the workers can schedule (cron expressions included). */
export function isValidCadence(raw: string): boolean {
  const parsed = parseCadence(raw)
  if (!parsed) return false
  if (parsed.kind === 'cron') return parseCronExpression(parsed.expression) !== null
  return true
}
