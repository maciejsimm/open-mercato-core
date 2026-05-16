import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { ParameterDef, ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import { Report } from '../data/entities'
import { loadDataset } from '../lib/datasets-registry'
import { executeReport } from '../lib/execute'
import { FieldAclDeniedError } from '../lib/field-redact'
import {
  REPORTS_ASYNC_EXECUTE_QUEUE,
  type AsyncExecuteJob,
} from '../lib/queues'

export const metadata = {
  queue: REPORTS_ASYNC_EXECUTE_QUEUE,
  id: 'reports:async-execute',
  concurrency: 3,
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Async execute worker — runs a single report off the main request path.
 *
 * Step 4.5 will extend this to write the result to the attachments module
 * and emit a `reports.execution_ready` notification once we have the
 * attachments handle. For now the worker exercises the executor so the
 * `OM_REPORTS_INMEMORY_CAP` over-cap branch in `lib/execute.ts` can dispatch
 * without crashing; the result is logged but not stored.
 */
export default async function handle(
  job: { payload: AsyncExecuteJob },
  ctx: HandlerContext,
): Promise<void> {
  const { reportId, tenantId, organizationId, params } = job.payload
  const em = (ctx.resolve('em') as EntityManager).fork()
  const report = await em.findOne(Report, {
    id: reportId,
    tenantId,
    organizationId,
    deletedAt: null,
  } as Record<string, unknown>)
  if (!report) return

  const userFeatures = new Set<string>(['*'])
  const dataset = await loadDataset(report.datasetId, userFeatures)
  if (!dataset) return

  const queryEngine = ctx.resolve('queryEngine') as QueryEngine
  const definition = report.definitionJson as ReportDefinition
  const parameterDefs = (report.parametersJson as ParameterDef[] | undefined) ?? undefined

  try {
    const out = await executeReport(queryEngine, {
      dataset,
      definition,
      userFeatures,
      tenantId,
      organizationId,
      params: params ?? {},
      parameterDefs,
    })
    // Phase 4.5 wires attachments + notifications here.
    if (typeof console !== 'undefined') {
      console.info('[reports/async-execute] completed', {
        reportId,
        rows: out.rows.length,
        truncated: out.meta.truncated,
      })
    }
  } catch (err) {
    if (err instanceof FieldAclDeniedError) {
      if (typeof console !== 'undefined') {
        console.warn('[reports/async-execute] field-ACL denied', { reportId, fields: err.fields })
      }
      return
    }
    throw err
  }
}
