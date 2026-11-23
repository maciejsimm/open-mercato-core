import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { ParameterDef, ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { defaultLocale } from '@open-mercato/shared/lib/i18n/config'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ReportExecution, ReportSchedule } from '../data/entities'
import { ScheduledReportEmail } from '../emails/ScheduledReportEmail'
import { emitReportsEvent } from '../events'
import { resolveAccessForUser } from '../lib/access'
import { hashParams } from '../lib/async-run'
import { loadDataset } from '../lib/datasets-registry'
import { buildEmailAttachments } from '../lib/email-attachments'
import { executeReport, type ExecutionResult } from '../lib/execute'
import { isReportExportFormat, serializeReportResult, type ReportExportFormat } from '../lib/export'
import { FieldAclDeniedError } from '../lib/field-redact'
import { isReportsAdmin } from '../lib/folder-acl'
import { findColumn, formatReportValue } from '../lib/format'
import { notifyReportsUser } from '../lib/notify'
import { resolveRecipientEmails } from '../lib/recipients'
import { canRunReport, loadScopedReport } from '../lib/report-access'
import { parseCadence, computeNextRunAt } from '../lib/schedule-cadence'
import { REPORTS_SCHEDULE_EXECUTE_QUEUE, type ScheduleExecuteJob } from '../lib/queues'

const logger = createLogger('reports').child({ component: 'workers/schedule-execute' })

export const metadata = {
  queue: REPORTS_SCHEDULE_EXECUTE_QUEUE,
  id: 'reports:schedule-execute',
  concurrency: 3,
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
}

export const MAX_SCHEDULE_FAILURES = 3
const PREVIEW_ROWS = 10

export class ScheduleRunError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

function appBaseUrl(): string | null {
  const raw = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL
  return raw ? raw.replace(/\/+$/, '') : null
}

function buildPreviewTable(
  result: ExecutionResult,
  locale: string,
  timeZone: string,
  translate: (key: string, fallback: string) => string,
): { headers: string[]; rows: string[][] } {
  const keys = result.meta.fields ?? (result.rows[0] ? Object.keys(result.rows[0]) : [])
  return {
    headers: keys,
    rows: result.rows.slice(0, PREVIEW_ROWS).map((row) =>
      keys.map((key) =>
        formatReportValue(row[key], findColumn(result.meta.columns, key), { locale, timeZone, translate, row }),
      ),
    ),
  }
}

/**
 * Run one due schedule and email the result.
 *
 * Execution identity (spec Q9 default a): the schedule runs as its
 * **owner** with live ACL — folder access, dataset visibility and field
 * ACL are re-resolved on every run. If the owner lost access the run
 * fails closed (failure count + owner notification after
 * `MAX_SCHEDULE_FAILURES`). External email recipients are delivered only
 * while the owner holds `reports.admin`.
 *
 * Idempotent on `scheduleId + nextRunAt`: a job whose `runAt` predates the
 * stored `nextRunAt` (another worker already ran it) exits immediately.
 */
export default async function handle(
  job: { payload: ScheduleExecuteJob },
  ctx: HandlerContext,
): Promise<void> {
  const { scheduleId, tenantId, organizationId } = job.payload
  const scope = { tenantId, organizationId }
  const em = (ctx.resolve('em') as EntityManager).fork()
  const schedule = await em.findOne(ReportSchedule, {
    id: scheduleId,
    tenantId,
    organizationId,
    deletedAt: null,
  } as Record<string, unknown>)
  if (!schedule || !schedule.enabled) return

  if (job.payload.runAt && schedule.nextRunAt) {
    const jobRunAt = new Date(job.payload.runAt).getTime()
    if (schedule.nextRunAt.getTime() > jobRunAt) return
  }

  const now = new Date()
  const report = await loadScopedReport(em, schedule.reportId, scope)
  const ownerUserId = schedule.ownerUserId ?? report?.ownerUserId ?? null
  const params = (schedule.paramsJson as Record<string, unknown> | undefined) ?? {}
  const execution = em.create(ReportExecution, {
    organizationId,
    tenantId,
    reportId: schedule.reportId,
    scheduleId: schedule.id,
    requestedByUserId: ownerUserId,
    paramsHash: hashParams(params),
    status: 'running',
    startedAt: now,
    createdAt: now,
  })
  em.persist(execution)
  await em.flush()

  const started = Date.now()
  try {
    if (!report) throw new ScheduleRunError('report_not_found')
    if (!ownerUserId) throw new ScheduleRunError('schedule_owner_missing')
    const access = await resolveAccessForUser(ctx, em, ownerUserId, scope)
    if (!(await canRunReport(em, report, access))) throw new ScheduleRunError('report_access_denied')
    const dataset = await loadDataset(report.datasetId, access.userFeatures)
    if (!dataset) throw new ScheduleRunError('dataset_not_visible')

    const definition = report.definitionJson as ReportDefinition
    const result = await executeReport(ctx.resolve('queryEngine') as QueryEngine, {
      dataset,
      definition,
      userFeatures: access.userFeatures,
      userId: access.userId,
      tenantId,
      organizationId,
      params,
      parameterDefs: (report.parametersJson as ParameterDef[] | undefined) ?? undefined,
      now,
      readAllPages: true,
    })

    const formats = ((schedule.formatsJson as unknown[] | undefined) ?? ['csv']).filter(isReportExportFormat) as ReportExportFormat[]
    const artifacts = (formats.length ? formats : (['csv'] as ReportExportFormat[])).map((format) =>
      serializeReportResult(definition, result, format, { sheetName: report.name }),
    )
    const { attachments, omitted } = buildEmailAttachments(report.name, artifacts)
    const { emails, droppedExternal } = await resolveRecipientEmails(em, schedule.recipientsJson, scope, {
      allowExternal: isReportsAdmin(access.userFeatures),
    })

    const dict = await loadDictionary(defaultLocale)
    const translate = createFallbackTranslator(dict)
    const timeZone = schedule.timezone || 'UTC'
    const baseUrl = appBaseUrl()
    const reportUrl = baseUrl ? `${baseUrl}/backend/reports/${report.id}` : undefined
    const vars = { reportName: report.name, scheduleName: schedule.name, rows: String(result.total) }
    const interpolate = (text: string) => text.replace(/\{(\w+)\}/g, (_m, key: string) => vars[key as keyof typeof vars] ?? '')
    const subject = interpolate(translate('reports.email.scheduled.subject', '{scheduleName}: {reportName}'))
    const copy = {
      preview: interpolate(translate('reports.email.scheduled.preview', '{reportName} — scheduled delivery')),
      title: interpolate(translate('reports.email.scheduled.title', '{reportName}')),
      summary: interpolate(translate('reports.email.scheduled.summary', 'Your scheduled report "{scheduleName}" returned {rows} rows.')),
      attachmentsNote: omitted.length
        ? translate('reports.email.scheduled.attachmentsOmitted', 'Some files were too large to attach — open the report in the app to download them.')
        : translate('reports.email.scheduled.attachmentsNote', 'The full result is attached.'),
      cta: translate('reports.email.scheduled.cta', 'Open report'),
      footer: translate('reports.email.scheduled.footer', 'You receive this email because you are a recipient of a scheduled report.'),
    }
    const previewTable = buildPreviewTable(result, defaultLocale, timeZone, translate)

    let delivered = 0
    for (const to of emails) {
      try {
        await sendEmail({
          to,
          subject,
          react: ScheduledReportEmail({ copy, previewTable, reportUrl }),
          attachments,
          tenantId,
          organizationId,
        })
        delivered += 1
      } catch (err) {
        logger.warn('Scheduled report email failed for one recipient', { scheduleId, err })
      }
    }
    if (emails.length > 0 && delivered === 0) throw new ScheduleRunError('email_delivery_failed')

    execution.status = 'completed'
    execution.completedAt = new Date()
    execution.rowCount = result.rows.length
    execution.durationMs = Date.now() - started
    execution.resultJson = result.rows
    execution.resultMetaJson = { ...result.meta, total: result.total, definition }
    schedule.failureCount = 0
    schedule.lastRunAt = new Date()
    const parsedCadence = parseCadence(schedule.cadence)
    schedule.nextRunAt = parsedCadence ? computeNextRunAt(parsedCadence, new Date(), schedule.timezone) : null
    await em.flush()

    await emitReportsEvent('reports.schedule.delivered', {
      id: schedule.id,
      scheduleId: schedule.id,
      reportId: report.id,
      executionId: execution.id,
      recipients: delivered,
      droppedExternalRecipients: droppedExternal,
      tenantId,
      organizationId,
    }, { persistent: true }).catch((err: unknown) => logger.warn('Failed to emit schedule delivered event', { err }))
    await notifyReportsUser(
      ctx,
      'reports.schedule_delivered',
      {
        recipientUserId: ownerUserId,
        bodyVariables: { scheduleName: schedule.name, reportName: report.name },
        sourceEntityType: 'reports:schedule',
        sourceEntityId: schedule.id,
        groupKey: `reports:schedule-delivered:${schedule.id}`,
      },
      scope,
    )
  } catch (err) {
    const code =
      err instanceof ScheduleRunError ? err.code : err instanceof FieldAclDeniedError ? 'field_acl_denied' : 'execution_failed'
    execution.status = 'failed'
    execution.completedAt = new Date()
    execution.durationMs = Date.now() - started
    execution.errorText = code
    schedule.failureCount = (schedule.failureCount ?? 0) + 1
    schedule.lastRunAt = new Date()
    const exhausted = schedule.failureCount >= MAX_SCHEDULE_FAILURES
    if (exhausted) {
      schedule.enabled = false
      schedule.nextRunAt = null
    }
    await em.flush()
    if (exhausted && ownerUserId) {
      await notifyReportsUser(
        ctx,
        'reports.schedule_failed',
        {
          recipientUserId: ownerUserId,
          bodyVariables: { scheduleName: schedule.name, reason: code },
          sourceEntityType: 'reports:schedule',
          sourceEntityId: schedule.id,
          groupKey: `reports:schedule-failed:${schedule.id}`,
        },
        scope,
      )
    }
    // No rethrow: the schedule stays due (nextRunAt unchanged), so the next
    // runner tick retries it; `failureCount` bounds retries without the
    // queue duplicating execution rows.
    logger.warn('Scheduled report run failed', { scheduleId, code, failureCount: schedule.failureCount, err })
  }
}
