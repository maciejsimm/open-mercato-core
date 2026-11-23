/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  CadencePicker,
  cadenceFromDraft,
  draftFromCadence,
} from '../backend/reports/schedules/components/CadencePicker'
import { describeCadence, describeRawCadence } from '../backend/reports/schedules/components/cadence-text'
import { parseCadence, type Cadence } from '../lib/schedule-cadence'
import { scheduleCreateSchema, scheduleUpdateSchema } from '../data/validators'

const t: TranslateFn = (_key, fallbackOrParams, params) => {
  const template = typeof fallbackOrParams === 'string' ? fallbackOrParams : ''
  const values = typeof fallbackOrParams === 'object' ? fallbackOrParams : params
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (values && name in values ? String(values[name]) : match))
}

describe('cadence draft <-> string', () => {
  test.each([
    'daily@06:05',
    'weekly:mon@09:00',
    'weekly:mon,wed,fri@09:00',
    'monthly:15@12:30',
    'monthly:last@23:59',
    'cron:0 9 * * 1-5',
  ])('round-trips %s', (raw) => {
    expect(cadenceFromDraft(draftFromCadence(raw))).toBe(raw)
  })

  test('unknown values fall back to the weekly default', () => {
    expect(cadenceFromDraft(draftFromCadence('garbage'))).toBe('weekly:mon@09:00')
  })

  test('weekly without days serializes to an invalid cadence', () => {
    expect(parseCadence(cadenceFromDraft({ ...draftFromCadence('weekly:mon@09:00'), days: [] }))).toBeNull()
  })
})

describe('describeCadence', () => {
  const describe_ = (raw: string, tz = 'Europe/Warsaw') => describeCadence(parseCadence(raw) as Cadence, tz, t, 'en')

  test('weekly lists days with a natural conjunction', () => {
    expect(describe_('weekly:mon,wed@09:00')).toBe('Every Mon and Wed at 09:00 (Europe/Warsaw)')
    expect(describe_('weekly:mon,tue,wed,thu,fri@08:00')).toBe('Every weekday at 08:00 (Europe/Warsaw)')
    expect(describe_('weekly:mon,tue,wed,thu,fri,sat,sun@08:00')).toBe('Every day at 08:00 (Europe/Warsaw)')
  })

  test('daily, monthly, last day and cron', () => {
    expect(describe_('daily@07:30', 'UTC')).toBe('Every day at 07:30 (UTC)')
    expect(describe_('monthly:5@10:00')).toBe('Monthly on day 5 at 10:00 (Europe/Warsaw)')
    expect(describe_('monthly:last@18:00')).toBe('Monthly on the last day at 18:00 (Europe/Warsaw)')
    expect(describe_('cron:0 9 * * 1')).toBe('Custom cron schedule "0 9 * * 1" (Europe/Warsaw)')
  })

  test('raw summaries reject unparseable values', () => {
    expect(describeRawCadence('cron:nope', 'UTC', t, 'en')).toBeNull()
    expect(describeRawCadence('weekly:mon@09:00', 'UTC', t, 'en')).toBe('Every Mon at 09:00 (UTC)')
  })
})

describe('CadencePicker', () => {
  function Harness({ initial, timezone, onValue }: { initial: string; timezone: string; onValue: (value: string) => void }) {
    const [value, setValue] = React.useState(initial)
    return (
      <CadencePicker
        id="cadence"
        value={value}
        timezone={timezone}
        onChange={(next) => { setValue(next); onValue(next) }}
      />
    )
  }

  test('toggling day pills emits a multi-day weekly cadence and updates the summary', () => {
    const onValue = jest.fn()
    renderWithProviders(<Harness initial="weekly:mon@09:00" timezone="Europe/Warsaw" onValue={onValue} />)
    fireEvent.click(screen.getByTestId('reports-schedule-day-wed'))
    expect(onValue).toHaveBeenLastCalledWith('weekly:mon,wed@09:00')
    expect(screen.getByTestId('reports-schedule-cadence-preview').textContent).toContain('Every Mon and Wed at 09:00 (Europe/Warsaw)')
    expect(screen.getByTestId('reports-schedule-cadence-preview').querySelectorAll('li')).toHaveLength(3)
  })

  test('removing the last day surfaces a validation message', () => {
    const onValue = jest.fn()
    renderWithProviders(<Harness initial="weekly:mon@09:00" timezone="UTC" onValue={onValue} />)
    fireEvent.click(screen.getByTestId('reports-schedule-day-mon'))
    expect(screen.getByRole('alert').textContent).toContain('Pick at least one day of the week.')
  })

  test('invalid cron shows a validation message instead of a preview', () => {
    const onValue = jest.fn()
    renderWithProviders(<Harness initial="cron:0 9 * * 1" timezone="UTC" onValue={onValue} />)
    expect(screen.getByTestId('reports-schedule-cadence-preview')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Cron expression'), { target: { value: '0 9 * *' } })
    expect(onValue).toHaveBeenLastCalledWith('cron:0 9 * *')
    expect(screen.getByRole('alert').textContent).toContain('valid 5-field cron expression')
    expect(screen.queryByTestId('reports-schedule-cadence-preview')).toBeNull()
  })

  test('changing the time keeps the frequency', () => {
    const onValue = jest.fn()
    renderWithProviders(<Harness initial="monthly:last@09:00" timezone="UTC" onValue={onValue} />)
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '17:45' } })
    expect(onValue).toHaveBeenLastCalledWith('monthly:last@17:45')
  })
})

describe('schedule validators', () => {
  const base = {
    reportId: '7d0c0a5e-8f3e-4f57-9a0a-0c3f6c1c1b11',
    name: 'Weekly sales',
    timezone: 'Europe/Warsaw',
    recipients: [{ type: 'email' as const, email: 'ops@example.com' }],
  }

  test.each([
    'weekly:mon@09:00',
    'monthly:28@09:00',
    'cron:0 9 * * 1',
    'daily@09:00',
    'weekly:mon,wed@09:00',
    'monthly:last@09:00',
  ])('accepts cadence %s', (cadence) => {
    expect(scheduleCreateSchema.safeParse({ ...base, cadence }).success).toBe(true)
  })

  test.each(['weekly:mon@9:00', 'monthly:29@09:00', 'cron:not cron', 'hourly', 'weekly:@09:00'])('rejects cadence %s', (cadence) => {
    expect(scheduleCreateSchema.safeParse({ ...base, cadence }).success).toBe(false)
  })

  test('rejects unknown timezones', () => {
    expect(scheduleCreateSchema.safeParse({ ...base, cadence: 'daily@09:00', timezone: 'Mars/Olympus' }).success).toBe(false)
    expect(scheduleUpdateSchema.safeParse({ id: base.reportId, timezone: 'Nowhere' }).success).toBe(false)
  })

  test('accepts every export format and rejects duplicates or unknown ones', () => {
    const formats = ['csv', 'xlsx', 'json', 'xml', 'markdown']
    expect(scheduleCreateSchema.safeParse({ ...base, cadence: 'daily@09:00', formats }).success).toBe(true)
    expect(scheduleCreateSchema.safeParse({ ...base, cadence: 'daily@09:00', formats: ['csv', 'csv'] }).success).toBe(false)
    expect(scheduleCreateSchema.safeParse({ ...base, cadence: 'daily@09:00', formats: ['pdf'] }).success).toBe(false)
    expect(scheduleCreateSchema.safeParse({ ...base, cadence: 'daily@09:00', formats: [] }).success).toBe(false)
  })
})
