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

const cadencePattern = /^(weekly:(mon|tue|wed|thu|fri|sat|sun)@([01]\d|2[0-3]):[0-5]\d|monthly:([1-9]|1\d|2[0-8])@([01]\d|2[0-3]):[0-5]\d|cron:.+)$/

const scheduleNewSchema = z.object({
  reportId: z.string().uuid({ message: 'Pick a report' }),
  name: z.string().trim().min(1).max(200),
  cadence: z.string().trim().regex(cadencePattern, { message: 'weekly:<dow>@HH:MM | monthly:<1..28>@HH:MM | cron:<expr>' }),
  timezone: z.string().trim().min(1).max(80),
  recipientsEmails: z.string().trim().max(2000),
  formats: z.string().trim().min(1).max(120),
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

function parseFormats(raw: string): string[] {
  return raw.split(/[,;\s]+/).map((p) => p.trim().toLowerCase()).filter((p) => p === 'csv' || p === 'xlsx')
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

  const fields: CrudField[] = [
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
      type: 'text',
      required: true,
      placeholder: 'weekly:mon@09:00',
      description: t(
        'reports.schedules.new.fields.cadenceHint',
        'Format: `weekly:<dow>@HH:MM` (e.g. `weekly:mon@09:00`), `monthly:<1..28>@HH:MM`, or `cron:<expression>`.',
      ),
    },
    {
      id: 'timezone',
      label: t('reports.schedules.new.fields.timezone', 'Timezone'),
      type: 'text',
      required: true,
      placeholder: 'Europe/Warsaw',
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
      type: 'text',
      required: true,
      placeholder: 'csv',
      description: t(
        'reports.schedules.new.fields.formatsHint',
        'Comma-separated subset of `csv,xlsx`. XLSX delivery activates once the `exceljs` dependency lands.',
      ),
    },
  ]

  const handleSubmit = React.useCallback(async (values: ScheduleNewValues) => {
    try {
      const recipients = parseEmails(values.recipientsEmails)
      if (recipients.length === 0) {
        throw createCrudFormError(t('reports.schedules.new.error.noRecipients', 'Add at least one valid email recipient.'))
      }
      const formats = parseFormats(values.formats)
      if (formats.length === 0) {
        throw createCrudFormError(t('reports.schedules.new.error.noFormats', 'Pick at least one of csv or xlsx.'))
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
            cadence: 'weekly:mon@09:00',
            timezone: detectDefaultTimezone(),
            formats: 'csv',
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
