import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { ParameterDef, ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import { Report, ReportSchedule } from '../data/entities'
import { loadDataset } from '../lib/datasets-registry'
import { executeReport } from '../lib/execute'
import { FieldAclDeniedError } from '../lib/field-redact'
import { parseCadence, computeNextRunAt } from '../lib/schedule-cadence'
import {
  REPORTS_SCHEDULE_EXECUTE_QUEUE,
  getExportBuildQueue,
  type ExportBuildJob,
  type ScheduleExecuteJob,
} from '../lib/queues'

export const metadata = {
  queue: REPORTS_SCHEDULE_EXECUTE_QUEUE,
  id: 'reports:schedule-execute',
  concurrency: 3,
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
}

const MAX_FAILURES = 3

/**
 * Run one schedule. The worker is idempotent on `scheduleId + nextRunAt`:
 * before doing any work it locks the schedule row by checking that the
 * stored `nextRunAt` still matches the job payload's `runAt`. If the
 * runner has already advanced the schedule (another worker won the race),
 * the job exits without side-effects.
 *
 * Email + attachment delivery lives in Step 4.3 (`lib/email-attachments.ts`
 * + `ScheduledReportEmail` template); this worker enqueues an
 * `reports-export-build` job per configured format and lets that worker
 * own the artifact lifecycle.
 */
export default async function handle(
  job: { payload: ScheduleExecuteJob },
  ctx: HandlerContext,
): Promise<void> {
  const { scheduleId, tenantId, organizationId } = job.payload
  const em = (ctx.resolve('em') as EntityManager).fork()
  const schedule = await em.findOne(ReportSchedule, {
    id: scheduleId,
    tenantId,
    organizationId,
    deletedAt: null,
  } as Record<string, unknown>)
  if (!schedule || !schedule.enabled) return

  // Race guard: if another worker already advanced this schedule, skip.
  if (job.payload.runAt && schedule.nextRunAt) {
    const jobRunAt = new Date(job.payload.runAt).getTime()
    if (schedule.nextRunAt.getTime() > jobRunAt) return
  }

  const report = await em.findOne(Report, {
    id: schedule.reportId,
    tenantId,
    organizationId,
    deletedAt: null,
  } as Record<string, unknown>)
  if (!report) {
    schedule.failureCount = (schedule.failureCount ?? 0) + 1
    schedule.lastRunAt = new Date()
    await em.flush()
    return
  }

  // The schedule executes as a system principal for the report owner — we
  // pass `userFeatures: ['*']` so the executor does not redact fields the
  // schedule owner intentionally included. (Phase 5 will look up the owner
  // and use their actual feature set.)
  const userFeatures = new Set<string>(['*'])
  const dataset = await loadDataset(report.datasetId, userFeatures)
  if (!dataset) {
    schedule.failureCount = (schedule.failureCount ?? 0) + 1
    schedule.lastRunAt = new Date()
    await em.flush()
    return
  }

  const queryEngine = ctx.resolve('queryEngine') as QueryEngine
  const definition = report.definitionJson as ReportDefinition
  const parameterDefs = (report.parametersJson as ParameterDef[] | undefined) ?? undefined
  const params = (schedule.paramsJson as Record<string, unknown> | undefined) ?? {}

  try {
    await executeReport(queryEngine, {
      dataset,
      definition,
      userFeatures,
      tenantId,
      organizationId,
      params,
      parameterDefs,
    })
    schedule.failureCount = 0
    schedule.lastRunAt = new Date()
    const parsedCadence = parseCadence(schedule.cadence)
    schedule.nextRunAt = parsedCadence ? computeNextRunAt(parsedCadence, new Date(), schedule.timezone) : null
    await em.flush()

    // Step 4.3 wires the email side; for now we enqueue export-build jobs
    // so attachments are at least built and stored for download from the
    // attachments module.
    const formats = (schedule.formatsJson as Array<string> | undefined) ?? ['csv']
    const exportQueue = getExportBuildQueue()
    for (const format of formats) {
      if (format !== 'csv' && format !== 'xlsx' && format !== 'json' && format !== 'xml' && format !== 'markdown') continue
      const exportJob: ExportBuildJob = {
        reportId: schedule.reportId,
        tenantId,
        organizationId,
        format,
        scheduleId: schedule.id,
        params,
      }
      await exportQueue.enqueue(exportJob)
    }
  } catch (err) {
    if (err instanceof FieldAclDeniedError) {
      schedule.failureCount = (schedule.failureCount ?? 0) + 1
      schedule.lastRunAt = new Date()
      await em.flush()
      return
    }
    schedule.failureCount = (schedule.failureCount ?? 0) + 1
    schedule.lastRunAt = new Date()
    if (schedule.failureCount >= MAX_FAILURES) {
      schedule.enabled = false
      schedule.nextRunAt = null
    }
    await em.flush()
    throw err
  }
}
