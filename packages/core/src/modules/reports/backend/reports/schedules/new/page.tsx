"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { z } from 'zod'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { isValidCadence, isValidTimeZone } from '../../../../lib/schedule-cadence'
import { SCHEDULE_FORMATS } from '../../../../data/validators'
import { CadencePicker, DEFAULT_CADENCE } from '../components/CadencePicker'
import { FormatsMultiSelect } from '../components/FormatsMultiSelect'
import { isScheduleFormat, listTimeZones } from '../components/cadence-text'

const scheduleNewSchema = z.object({
  reportId: z.string().uuid({ message: 'reports.schedules.new.validation.report' }),
  name: z.string().trim().min(1).max(200),
  cadence: z.string().trim().refine(isValidCadence, { message: 'reports.schedules.new.validation.cadence' }),
  timezone: z.string().trim().min(1).max(80).refine(isValidTimeZone, { message: 'reports.schedules.new.validation.timezone' }),
  recipientsEmails: z.string().trim().max(2000),
  formats: z.array(z.enum(SCHEDULE_FORMATS)).min(1, { message: 'reports.schedules.new.error.noFormats' }),
  enabled: z.boolean().optional(),
})
type ScheduleNewValues = z.infer<typeof scheduleNewSchema>

type ReportOption = { id: string; name: string }

function parseEmails(raw: string): Array<{ type: 'email'; email: string }> {
  const out: Array<{ type: 'email'; email: string }> = []
  for (const piece of raw.split(/[,;\s]+/)) {
    const value = piece.trim()
    if (!value) continue
    // Loose validation — zod's `.email()` runs on the API.
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      out.push({ type: 'email', email: value })
    }
  }
  return out
}

function detectDefaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export default function SchedulesNewPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useT()
  const initialReportId = searchParams?.get('reportId') ?? ''

  const loadReportOptions = React.useCallback(async () => {
    const call = await apiCall<{ items?: ReportOption[] }>(
      '/api/reports/reports?pageSize=100',
      undefined,
      { fallback: { items: [] } },
    )
    if (!call.ok) return []
    const items = Array.isArray(call.result?.items) ? call.result!.items! : []
    return items.map((r) => ({ value: r.id, label: r.name }))
  }, [])

  const defaultTimezone = React.useMemo(() => detectDefaultTimezone(), [])
  const timeZones = React.useMemo(() => listTimeZones(defaultTimezone), [defaultTimezone])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'reportId',
      label: t('reports.schedules.new.fields.report', 'Report'),
      type: 'select',
      required: true,
      loadOptions: loadReportOptions,
    },
    {
      id: 'name',
      label: t('reports.schedules.new.fields.name', 'Name'),
      type: 'text',
      required: true,
      description: t('reports.schedules.new.fields.nameHint', 'Visible in the schedules list and email subject.'),
    },
    {
      id: 'cadence',
      label: t('reports.schedules.new.fields.cadence', 'Cadence'),
      type: 'custom',
      required: true,
      rendersOwnError: true,
      component: ({ id, value, values, error, disabled, setValue }) => (
        <CadencePicker
          id={id}
          value={typeof value === 'string' ? value : ''}
          timezone={typeof values?.timezone === 'string' ? values.timezone : ''}
          error={error}
          disabled={disabled}
          onChange={setValue}
        />
      ),
    },
    {
      id: 'timezone',
      label: t('reports.schedules.new.fields.timezone', 'Timezone'),
      type: 'combobox',
      required: true,
      placeholder: 'Europe/Warsaw',
      suggestions: timeZones,
      allowCustomValues: false,
      description: t('reports.schedules.new.fields.timezoneHint', 'IANA timezone name. Defaults to the browser timezone.'),
    },
    {
      id: 'recipientsEmails',
      label: t('reports.schedules.new.fields.recipients', 'Recipient emails'),
      type: 'textarea',
      required: true,
      description: t(
        'reports.schedules.new.fields.recipientsHint',
        'Comma- or newline-separated email addresses. User + role recipients can be added later via the API.',
      ),
    },
    {
      id: 'formats',
      label: t('reports.schedules.new.fields.formats', 'Formats'),
      type: 'custom',
      required: true,
      description: t('reports.schedules.new.fields.formatsHint', 'Each selected format is attached to the delivery email.'),
      component: ({ id, value, disabled, setValue }) => (
        <FormatsMultiSelect
          id={id}
          value={Array.isArray(value) ? value.filter(isScheduleFormat) : []}
          disabled={disabled}
          onChange={setValue}
        />
      ),
    },
  ], [loadReportOptions, t, timeZones])

  const handleSubmit = React.useCallback(async (values: ScheduleNewValues) => {
    try {
      const recipients = parseEmails(values.recipientsEmails)
      if (recipients.length === 0) {
        throw createCrudFormError(t('reports.schedules.new.error.noRecipients', 'Add at least one valid email recipient.'))
      }
      const formats = SCHEDULE_FORMATS.filter((format) => values.formats.includes(format))
      if (formats.length === 0) {
        throw createCrudFormError(t('reports.schedules.new.error.noFormats', 'Pick at least one format.'))
      }
      const payload = {
        reportId: values.reportId,
        name: values.name,
        cadence: values.cadence,
        timezone: values.timezone,
        recipients,
        formats,
        enabled: values.enabled ?? true,
      }
      const response = await readApiResultOrThrow<{ id: string }>(
        '/api/reports/schedules',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!response?.id) {
        throw createCrudFormError(t('reports.schedules.new.error.create', 'Failed to create schedule.'))
      }
      flash(t('reports.schedules.new.success', 'Schedule created.'), 'success')
      router.push('/backend/reports/schedules')
    } catch (err) {
      if (err && typeof err === 'object' && 'message' in err) throw err
      throw createCrudFormError(t('reports.schedules.new.error.create', 'Failed to create schedule.'))
    }
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <CrudForm<ScheduleNewValues>
          title={t('reports.schedules.new.pageTitle', 'New Schedule')}
          schema={scheduleNewSchema}
          fields={fields}
          initialValues={{
            reportId: initialReportId,
            cadence: DEFAULT_CADENCE,
            timezone: defaultTimezone,
            formats: ['csv'],
            enabled: true,
          } as Partial<ScheduleNewValues>}
          submitLabel={t('reports.schedules.new.actions.create', 'Create schedule')}
          cancelHref="/backend/reports/schedules"
          backHref="/backend/reports/schedules"
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
