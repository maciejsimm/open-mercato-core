import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { ParameterDef, ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ReportExecution, ReportSchedule } from '../data/entities'
import { resolveAccessForUser } from '../lib/access'
import { hashParams } from '../lib/async-run'
import { loadDataset } from '../lib/datasets-registry'
import { executeReport } from '../lib/execute'
import { isReportExportFormat } from '../lib/export'
import { FieldAclDeniedError } from '../lib/field-redact'
import { notifyReportsUser } from '../lib/notify'
import { canRunReport, loadScopedReport } from '../lib/report-access'
import { REPORTS_EXPORT_BUILD_QUEUE, type ExportBuildJob } from '../lib/queues'

const logger = createLogger('reports').child({ component: 'workers/export-build' })

export const metadata = {
  queue: REPORTS_EXPORT_BUILD_QUEUE,
  id: 'reports:export-build',
  concurrency: 3,
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Export build worker — runs a report for a background export and stores
 * the result on a `reports_executions` row; the requester gets a
 * `reports.export_ready` notification whose action downloads it in the
 * requested format (`/api/reports/executions/:id/download`).
 *
 * Runs as `requestedByUserId` (or the schedule owner when only
 * `scheduleId` is given) with live ACL. Never runs with a wildcard
 * identity: a job without a resolvable principal is dropped.
 */
export default async function handle(
  job: { payload: ExportBuildJob },
  ctx: HandlerContext,
): Promise<void> {
  const { reportId, tenantId, organizationId, format, scheduleId, params, requestedByUserId } = job.payload
  if (!isReportExportFormat(format)) return
  const scope = { tenantId, organizationId }
  const em = (ctx.resolve('em') as EntityManager).fork()
  const report = await loadScopedReport(em, reportId, scope)
  if (!report) return

  let principal = requestedByUserId ?? null
  if (!principal && scheduleId) {
    const schedule = await em.findOne(ReportSchedule, { id: scheduleId, tenantId, organizationId } as Record<string, unknown>)
    principal = schedule?.ownerUserId ?? report.ownerUserId ?? null
  }
  if (!principal) {
    logger.warn('Export job without a principal; skipped', { reportId, scheduleId })
    return
  }
  const access = await resolveAccessForUser(ctx, em, principal, scope)
  if (!(await canRunReport(em, report, access))) return
  const dataset = await loadDataset(report.datasetId, access.userFeatures)
  if (!dataset) return

  const definition = report.definitionJson as ReportDefinition
  const started = Date.now()
  try {
    const result = await executeReport(ctx.resolve('queryEngine') as QueryEngine, {
      dataset,
      definition,
      userFeatures: access.userFeatures,
      userId: access.userId,
      tenantId,
      organizationId,
      params: params ?? {},
      parameterDefs: (report.parametersJson as ParameterDef[] | undefined) ?? undefined,
      readAllPages: true,
    })
    const execution = em.create(ReportExecution, {
      organizationId,
      tenantId,
      reportId,
      scheduleId: scheduleId ?? null,
      requestedByUserId: principal,
      paramsHash: hashParams(params),
      status: 'completed',
      startedAt: new Date(started),
      completedAt: new Date(),
      rowCount: result.rows.length,
      durationMs: Date.now() - started,
      resultJson: result.rows,
      resultMetaJson: { ...result.meta, total: result.total, definition, format },
      createdAt: new Date(),
    })
    em.persist(execution)
    await em.flush()
    await notifyReportsUser(
      ctx,
      'reports.export_ready',
      {
        recipientUserId: principal,
        bodyVariables: { reportName: report.name },
        sourceEntityType: 'reports:execution',
        sourceEntityId: execution.id,
        linkHref: `/api/reports/executions/${execution.id}/download?format=${format}`,
        groupKey: `reports:export:${execution.id}`,
      },
      scope,
    )
  } catch (err) {
    if (err instanceof FieldAclDeniedError) {
      logger.warn('Export denied by field ACL', { reportId, fields: err.fields })
      return
    }
    throw err
  }
}
