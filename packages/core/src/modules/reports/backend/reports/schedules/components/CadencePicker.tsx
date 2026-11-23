"use client"

import * as React from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import {
  DAYS_OF_WEEK,
  MAX_MONTHLY_DAY,
  computeNextRunTimes,
  formatCadence,
  isValidTimeZone,
  parseCadence,
  parseCronExpression,
  sortDaysOfWeek,
  type Cadence,
  type DayOfWeek,
} from '../../../../lib/schedule-cadence'
import { dayOfWeekLabel, describeCadence, formatRunTime } from './cadence-text'

export type CadenceFrequency = 'daily' | 'weekly' | 'monthly' | 'cron'

export type CadenceDraft = {
  frequency: CadenceFrequency
  time: string
  days: DayOfWeek[]
  monthDay: string
  cron: string
}

export const DEFAULT_CADENCE = 'weekly:mon@09:00'
const PREVIEW_RUNS = 3
const FREQUENCIES: readonly CadenceFrequency[] = ['daily', 'weekly', 'monthly', 'cron']
const MONTH_DAY_OPTIONS: string[] = [...Array.from({ length: MAX_MONTHLY_DAY }, (_, index) => String(index + 1)), 'last']

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function draftFromCadence(raw: string): CadenceDraft {
  const base: CadenceDraft = { frequency: 'weekly', time: '09:00', days: ['mon'], monthDay: '1', cron: '0 9 * * 1' }
  const parsed = parseCadence(raw)
  if (!parsed) return base
  if (parsed.kind === 'cron') return { ...base, frequency: 'cron', cron: parsed.expression }
  const time = `${pad(parsed.hour)}:${pad(parsed.minute)}`
  if (parsed.kind === 'daily') return { ...base, frequency: 'daily', time }
  if (parsed.kind === 'weekly') return { ...base, frequency: 'weekly', time, days: parsed.dows.length ? parsed.dows : [parsed.dow] }
  return { ...base, frequency: 'monthly', time, monthDay: String(parsed.day) }
}

export function cadenceFromDraft(draft: CadenceDraft): string {
  if (draft.frequency === 'cron') return `cron:${draft.cron.trim()}`
  const match = /^(\d{2}):(\d{2})$/.exec(draft.time)
  const hour = match ? Number(match[1]) : 9
  const minute = match ? Number(match[2]) : 0
  let cadence: Cadence
  if (draft.frequency === 'daily') {
    cadence = { kind: 'daily', hour, minute }
  } else if (draft.frequency === 'weekly') {
    const dows = sortDaysOfWeek(draft.days)
    if (!dows.length) return `weekly:@${draft.time}`
    cadence = { kind: 'weekly', dow: dows[0], dows, hour, minute }
  } else {
    cadence = { kind: 'monthly', day: draft.monthDay === 'last' ? 'last' : Number(draft.monthDay), hour, minute }
  }
  return formatCadence(cadence)
}

export type CadencePickerProps = {
  id: string
  value: string
  timezone: string
  error?: string
  disabled?: boolean
  onChange: (next: string) => void
}

export function CadencePicker({ id, value, timezone, error, disabled, onChange }: CadencePickerProps) {
  const t = useT()
  const locale = useLocale()
  const [draft, setDraft] = React.useState<CadenceDraft>(() => draftFromCadence(value || DEFAULT_CADENCE))
  const lastEmitted = React.useRef<string>(value)

  React.useEffect(() => {
    if (value === lastEmitted.current) return
    lastEmitted.current = value
    if (value) setDraft(draftFromCadence(value))
  }, [value])

  const update = React.useCallback((patch: Partial<CadenceDraft>) => {
    const next = { ...draft, ...patch }
    const nextSerialized = cadenceFromDraft(next)
    lastEmitted.current = nextSerialized
    setDraft(next)
    onChange(nextSerialized)
  }, [draft, onChange])

  const toggleDay = React.useCallback((day: DayOfWeek) => {
    const days = draft.days.includes(day) ? draft.days.filter((entry) => entry !== day) : [...draft.days, day]
    update({ days: sortDaysOfWeek(days) })
  }, [draft.days, update])

  const serialized = cadenceFromDraft(draft)
  const cronInvalid = draft.frequency === 'cron' && !parseCronExpression(draft.cron)
  const daysMissing = draft.frequency === 'weekly' && draft.days.length === 0
  const timezoneValid = isValidTimeZone(timezone)
  const effectiveTimezone = timezoneValid ? timezone : 'UTC'

  const preview = React.useMemo((): { summary: string | null; runs: Date[] } => {
    const parsed = parseCadence(serialized)
    if (!parsed || cronInvalid || !timezoneValid) return { summary: null, runs: [] }
    return {
      summary: describeCadence(parsed, effectiveTimezone, t, locale),
      runs: computeNextRunTimes(parsed, new Date(), effectiveTimezone, PREVIEW_RUNS),
    }
  }, [cronInvalid, effectiveTimezone, locale, serialized, t, timezoneValid])

  const frequencyLabel = (frequency: CadenceFrequency): string => {
    switch (frequency) {
      case 'daily': return t('reports.schedules.cadence.frequency.daily', 'Daily')
      case 'weekly': return t('reports.schedules.cadence.frequency.weekly', 'Weekly')
      case 'monthly': return t('reports.schedules.cadence.frequency.monthly', 'Monthly')
      case 'cron': return t('reports.schedules.cadence.frequency.cron', 'Custom (cron)')
    }
  }

  const localError = cronInvalid
    ? t('reports.schedules.cadence.errors.cron', 'Enter a valid 5-field cron expression (minute hour day-of-month month day-of-week), e.g. "0 9 * * 1-5".')
    : daysMissing
      ? t('reports.schedules.cadence.errors.days', 'Pick at least one day of the week.')
      : null
  const shownError = localError ?? error ?? null

  return (
    <div className="flex flex-col gap-3" data-testid="reports-schedule-cadence-picker">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-muted-foreground" id={`${id}-frequency-label`}>
            {t('reports.schedules.cadence.fields.frequency', 'Frequency')}
          </span>
          <Select
            value={draft.frequency}
            onValueChange={(next) => update({ frequency: next as CadenceFrequency })}
            disabled={disabled}
          >
            <SelectTrigger id={id} aria-labelledby={`${id}-frequency-label`} data-crud-focus-target="">
              <SelectValue>{frequencyLabel(draft.frequency)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {FREQUENCIES.map((frequency) => (
                <SelectItem key={frequency} value={frequency}>{frequencyLabel(frequency)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {draft.frequency !== 'cron' ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground" htmlFor={`${id}-time`}>
              {t('reports.schedules.cadence.fields.time', 'Time')}
            </label>
            <Input
              id={`${id}-time`}
              type="time"
              step={60}
              value={draft.time}
              disabled={disabled}
              onChange={(event) => {
                if (/^\d{2}:\d{2}$/.test(event.target.value)) update({ time: event.target.value })
              }}
            />
          </div>
        ) : null}
      </div>

      {draft.frequency === 'weekly' ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-muted-foreground" id={`${id}-days-label`}>
            {t('reports.schedules.cadence.fields.days', 'Days of the week')}
          </span>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${id}-days-label`}>
            {DAYS_OF_WEEK.map((day) => {
              const active = draft.days.includes(day)
              return (
                <Button
                  key={day}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  className="rounded-full"
                  aria-pressed={active}
                  disabled={disabled}
                  onClick={() => toggleDay(day)}
                  data-testid={`reports-schedule-day-${day}`}
                >
                  {dayOfWeekLabel(day, t)}
                </Button>
              )
            })}
          </div>
        </div>
      ) : null}

      {draft.frequency === 'monthly' ? (
        <div className="flex flex-col gap-1.5 sm:max-w-xs">
          <span className="text-sm text-muted-foreground" id={`${id}-monthday-label`}>
            {t('reports.schedules.cadence.fields.monthDay', 'Day of the month')}
          </span>
          <Select value={draft.monthDay} onValueChange={(next) => update({ monthDay: next })} disabled={disabled}>
            <SelectTrigger aria-labelledby={`${id}-monthday-label`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_DAY_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option === 'last' ? t('reports.schedules.cadence.lastDay', 'Last day of the month') : option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {draft.frequency === 'cron' ? (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm text-muted-foreground" htmlFor={`${id}-cron`}>
            {t('reports.schedules.cadence.fields.cron', 'Cron expression')}
          </label>
          <Input
            id={`${id}-cron`}
            value={draft.cron}
            disabled={disabled}
            placeholder="0 9 * * 1-5"
            inputClassName="font-mono"
            aria-invalid={cronInvalid || undefined}
            onChange={(event) => update({ cron: event.target.value })}
          />
          <span className="text-xs text-muted-foreground">
            {t('reports.schedules.cadence.cronHint', 'Five fields: minute, hour, day of month, month, day of week. Evaluated in the selected timezone.')}
          </span>
        </div>
      ) : null}

      {shownError ? (
        <p className="text-xs text-status-error-text" role="alert">{shownError}</p>
      ) : null}

      {preview.summary ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2" data-testid="reports-schedule-cadence-preview">
          <p className="text-sm font-medium text-foreground">{preview.summary}</p>
          {preview.runs.length ? (
            <div className="mt-1.5">
              <p className="text-xs text-muted-foreground">
                {t('reports.schedules.cadence.nextRuns', 'Next runs')}
              </p>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {preview.runs.map((run) => (
                  <li key={run.toISOString()} className="text-xs text-foreground">
                    {formatRunTime(run, effectiveTimezone, locale)}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('reports.schedules.cadence.noUpcomingRuns', 'No upcoming runs found for this cadence.')}
            </p>
          )}
        </div>
      ) : !timezoneValid ? (
        <p className="text-xs text-muted-foreground">
          {t('reports.schedules.cadence.previewNeedsTimezone', 'Pick a valid timezone to preview upcoming runs.')}
        </p>
      ) : null}
    </div>
  )
}
