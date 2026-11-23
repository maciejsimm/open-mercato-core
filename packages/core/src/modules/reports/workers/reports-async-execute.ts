import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { ParameterDef, ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ReportExecution } from '../data/entities'
import { resolveAccessForUser } from '../lib/access'
import { loadDataset } from '../lib/datasets-registry'
import { executeReport, readAsyncCap } from '../lib/execute'
import { FieldAclDeniedError } from '../lib/field-redact'
import { executionDownloadHref, notifyReportsUser } from '../lib/notify'
import { canRunReport, loadScopedReport } from '../lib/report-access'
import { REPORTS_ASYNC_EXECUTE_QUEUE, type AsyncExecuteJob } from '../lib/queues'

const logger = createLogger('reports').child({ component: 'workers/async-execute' })

export const metadata = {
  queue: REPORTS_ASYNC_EXECUTE_QUEUE,
  id: 'reports:async-execute',
  concurrency: 3,
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Async execute worker — runs a report that would exceed the sync in-memory
 * cap (or was explicitly requested async) off the request path.
 *
 * Executes as the **requesting user** with live ACL (folder access and
 * field ACL are re-checked here, never trusted from dispatch time), stores
 * the bounded result on the `reports_executions` row and notifies the
 * requester with a download link. Fails closed: no requester → no run.
 */
export default async function handle(
  job: { payload: AsyncExecuteJob },
  ctx: HandlerContext,
): Promise<void> {
  const { executionId, requestedByUserId, reportId, tenantId, organizationId, params } = job.payload
  if (!executionId || !requestedByUserId) {
    logger.warn('Async job without execution id or requester; skipped', { reportId })
    return
  }
  const scope = { tenantId, organizationId }
  const em = (ctx.resolve('em') as EntityManager).fork()
  const execution = await em.findOne(ReportExecution, { id: executionId, tenantId, organizationId } as Record<string, unknown>)
  if (!execution || execution.status !== 'running') return

  const fail = async (message: string) => {
    execution.status = 'failed'
    execution.errorText = message
    execution.completedAt = new Date()
    await em.flush()
  }

  const report = await loadScopedReport(em, reportId, scope)
  if (!report) return fail('report_not_found')
  const access = await resolveAccessForUser(ctx, em, requestedByUserId, scope)
  if (!(await canRunReport(em, report, access))) return fail('report_access_denied')
  const dataset = await loadDataset(report.datasetId, access.userFeatures)
  if (!dataset) return fail('dataset_not_visible')

  const definition = report.definitionJson as ReportDefinition
  const started = Date.now()
  try {
    const out = await executeReport(ctx.resolve('queryEngine') as QueryEngine, {
      dataset,
      definition,
      userFeatures: access.userFeatures,
      userId: access.userId,
      tenantId,
      organizationId,
      params: params ?? {},
      parameterDefs: (report.parametersJson as ParameterDef[] | undefined) ?? undefined,
      inMemoryCap: readAsyncCap(),
      readAllPages: true,
    })
    execution.status = 'completed'
    execution.completedAt = new Date()
    execution.rowCount = out.rows.length
    execution.durationMs = Date.now() - started
    execution.resultJson = out.rows
    execution.resultMetaJson = { ...out.meta, total: out.total, definition }
    await em.flush()
    await notifyReportsUser(
      ctx,
      'reports.execution_ready',
      {
        recipientUserId: requestedByUserId,
        bodyVariables: { reportName: report.name },
        sourceEntityType: 'reports:report',
        sourceEntityId: report.id,
        linkHref: executionDownloadHref(execution.id, 'csv'),
        groupKey: `reports:execution:${execution.id}`,
      },
      scope,
    )
  } catch (err) {
    if (err instanceof FieldAclDeniedError) return fail('field_acl_denied')
    await fail(err instanceof Error ? err.message.slice(0, 500) : 'execution_failed')
    throw err
  }
}
