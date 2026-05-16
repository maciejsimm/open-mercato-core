import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { ParameterDef, ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import type { CrudExportFormat } from '@open-mercato/shared/lib/crud/exporters'
import { Report } from '../data/entities'
import { loadDataset } from '../lib/datasets-registry'
import { runReportExport } from '../lib/export'
import { FieldAclDeniedError } from '../lib/field-redact'
import {
  REPORTS_EXPORT_BUILD_QUEUE,
  type ExportBuildJob,
} from '../lib/queues'

export const metadata = {
  queue: REPORTS_EXPORT_BUILD_QUEUE,
  id: 'reports:export-build',
  concurrency: 3,
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
}

const SUPPORTED_FORMATS: CrudExportFormat[] = ['csv', 'json', 'xml', 'markdown']

/**
 * Export build worker — runs a single report through the executor + shared
 * serializer and produces a binary artifact ready for delivery.
 *
 * Step 4.3 wires the email-attachments path that consumes the produced
 * artifact; Step 4.5 wires the attachments-module persistence. For now
 * the worker exercises the full executor + serializer pipeline so the
 * schedule-execute worker can confidently enqueue export jobs.
 *
 * XLSX support depends on the deferred `exceljs` dependency (Step 3.6b).
 * Until that lands the worker logs a "skipped — xlsx-not-yet-supported"
 * notice rather than throwing.
 */
export default async function handle(
  job: { payload: ExportBuildJob },
  ctx: HandlerContext,
): Promise<void> {
  const { reportId, tenantId, organizationId, format, scheduleId, params } = job.payload
  if (!SUPPORTED_FORMATS.includes(format as CrudExportFormat)) {
    if (typeof console !== 'undefined') {
      console.info('[reports/export-build] skipped — format not yet supported', { format, reportId, scheduleId })
    }
    return
  }

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
    const artifact = await runReportExport(
      queryEngine,
      {
        dataset,
        definition,
        userFeatures,
        tenantId,
        organizationId,
        params: params ?? {},
        parameterDefs,
      },
      format as CrudExportFormat,
    )
    if (typeof console !== 'undefined') {
      console.info('[reports/export-build] completed', {
        reportId,
        scheduleId,
        format,
        bytes: artifact.body.length,
        truncated: artifact.truncated,
      })
    }
  } catch (err) {
    if (err instanceof FieldAclDeniedError) {
      if (typeof console !== 'undefined') {
        console.warn('[reports/export-build] field-ACL denied', { reportId, scheduleId, format, fields: err.fields })
      }
      return
    }
    throw err
  }
}
