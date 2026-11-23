import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  DAYS_OF_WEEK,
  isValidTimeZone,
  parseCadence,
  parseCronExpression,
  type Cadence,
  type DayOfWeek,
} from '../../../../lib/schedule-cadence'
import { SCHEDULE_FORMATS, type ScheduleFormat } from '../../../../data/validators'

const WEEKDAYS: readonly DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri']

export function dayOfWeekLabel(day: DayOfWeek, t: TranslateFn): string {
  const fallbacks: Record<DayOfWeek, string> = {
    mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
  }
  return t(`reports.schedules.cadence.days.${day}`, fallbacks[day])
}

export function formatLabel(format: ScheduleFormat, t: TranslateFn): string {
  const fallbacks: Record<ScheduleFormat, string> = {
    csv: 'CSV', xlsx: 'Excel (XLSX)', json: 'JSON', xml: 'XML', markdown: 'Markdown',
  }
  return t(`reports.schedules.formats.${format}`, fallbacks[format])
}

export function isScheduleFormat(value: unknown): value is ScheduleFormat {
  return typeof value === 'string' && (SCHEDULE_FORMATS as readonly string[]).includes(value)
}

function joinList(items: string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items)
  } catch {
    return items.join(', ')
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function describeDays(days: DayOfWeek[], t: TranslateFn, locale: string): string {
  if (days.length === DAYS_OF_WEEK.length) return t('reports.schedules.cadence.summary.everyDayShort', 'day')
  if (days.length === WEEKDAYS.length && WEEKDAYS.every((day) => days.includes(day))) {
    return t('reports.schedules.cadence.summary.weekdays', 'weekday')
  }
  return joinList(days.map((day) => dayOfWeekLabel(day, t)), locale)
}

/** Human-readable summary of a parsed cadence, e.g. "Every Mon and Wed at 09:00 (Europe/Warsaw)". */
export function describeCadence(cadence: Cadence, timezone: string, t: TranslateFn, locale: string): string {
  const tz = timezone || 'UTC'
  if (cadence.kind === 'cron') {
    return t('reports.schedules.cadence.summary.cron', 'Custom cron schedule "{expression}" ({timezone})', {
      expression: cadence.expression,
      timezone: tz,
    })
  }
  const time = `${pad(cadence.hour)}:${pad(cadence.minute)}`
  if (cadence.kind === 'daily') {
    return t('reports.schedules.cadence.summary.daily', 'Every day at {time} ({timezone})', { time, timezone: tz })
  }
  if (cadence.kind === 'weekly') {
    const days = cadence.dows.length ? cadence.dows : [cadence.dow]
    return t('reports.schedules.cadence.summary.weekly', 'Every {days} at {time} ({timezone})', {
      days: describeDays(days, t, locale),
      time,
      timezone: tz,
    })
  }
  if (cadence.day === 'last') {
    return t('reports.schedules.cadence.summary.monthlyLast', 'Monthly on the last day at {time} ({timezone})', {
      time,
      timezone: tz,
    })
  }
  return t('reports.schedules.cadence.summary.monthly', 'Monthly on day {day} at {time} ({timezone})', {
    day: cadence.day,
    time,
    timezone: tz,
  })
}

/** Summary for a raw stored cadence string; `null` when it cannot be parsed. */
export function describeRawCadence(raw: string, timezone: string, t: TranslateFn, locale: string): string | null {
  const parsed = parseCadence(raw)
  if (!parsed) return null
  if (parsed.kind === 'cron' && !parseCronExpression(parsed.expression)) return null
  return describeCadence(parsed, timezone, t, locale)
}

export function formatRunTime(at: Date, timezone: string, locale: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: isValidTimeZone(timezone) ? timezone : 'UTC' }).format(at)
  } catch {
    return at.toISOString()
  }
}

export function listTimeZones(current: string): string[] {
  let zones: string[] = []
  try {
    zones = Intl.supportedValuesOf('timeZone')
  } catch {
    zones = []
  }
  const out = new Set<string>(['UTC', ...zones])
  if (current && isValidTimeZone(current)) out.add(current)
  return [...out]
}
