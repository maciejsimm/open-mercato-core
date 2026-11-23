import { NextResponse } from 'next/server'
import { z } from 'zod'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ReportDefinition, ReportColumnDescriptor } from '@open-mercato/shared/modules/reports/dsl'
import { ReportExecution } from '../../../../data/entities'
import { resolveReportsRequestAccess } from '../../../../lib/access'
import { loadDataset } from '../../../../lib/datasets-registry'
import type { ExecutionResult } from '../../../../lib/execute'
import {
  REPORT_EXPORT_FORMATS,
  normalizeReportExportFormat,
  reportExportFilename,
  serializeReportResult,
} from '../../../../lib/export'
import { FieldAclDeniedError, validateDefinitionAgainstAcl } from '../../../../lib/field-redact'
import { canRunReport, loadScopedReport } from '../../../../lib/report-access'
import { reportsTag, reportsErrorSchema } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['reports.view'] },
}

function notFound() {
  return NextResponse.json({ error: { code: 'REPORT_EXECUTION_NOT_FOUND', message: 'Execution not found' } }, { status: 404 })
}

/**
 * Download a completed async execution. Only the requester may download,
 * and access is re-checked now (folder ACL + field ACL against the live
 * grants), so a revoked share or field permission stops the download.
 */
export async function GET(req: Request, ctx: { params?: { id?: string } }) {
  const executionId = ctx.params?.id
  if (!executionId || !z.string().uuid().safeParse(executionId).success) return notFound()
  const url = new URL(req.url)
  const rawFormat = url.searchParams.get('format')
  const format = rawFormat ? normalizeReportExportFormat(rawFormat) : 'csv'
  if (!format) {
    return NextResponse.json(
      {
        error: {
          code: 'REPORT_EXPORT_FORMAT_UNSUPPORTED',
          message: `Format '${rawFormat}' is not supported. Supported: ${REPORT_EXPORT_FORMATS.join(', ')}.`,
        },
      },
      { status: 400 },
    )
  }
  const resolved = await resolveReportsRequestAccess(req)
  if (!resolved.ok) return resolved.response
  const { access, em } = resolved
  const execution = await findOneWithDecryption(
    em,
    ReportExecution,
    { id: executionId, tenantId: access.tenantId, organizationId: access.organizationId } as Record<string, unknown>,
    {},
    { tenantId: access.tenantId, organizationId: access.organizationId },
  )
  if (!execution || execution.requestedByUserId !== access.userId) return notFound()
  if (execution.status !== 'completed' || !execution.resultJson || !execution.resultMetaJson) {
    return NextResponse.json(
      { error: { code: 'REPORT_EXECUTION_NOT_READY', message: 'Execution has not completed' } },
      { status: 409 },
    )
  }
  const report = await loadScopedReport(em, execution.reportId, access)
  if (!report || !(await canRunReport(em, report, access))) return notFound()

  const meta = execution.resultMetaJson as ExecutionResult['meta'] & { definition?: ReportDefinition; total?: number }
  const definition = meta.definition ?? (report.definitionJson as ReportDefinition)
  const dataset = await loadDataset(report.datasetId, access.userFeatures)
  if (!dataset) return notFound()
  try {
    validateDefinitionAgainstAcl(definition, dataset, access.userFeatures)
  } catch (err) {
    if (err instanceof FieldAclDeniedError) {
      return NextResponse.json(
        { error: { code: err.code, message: 'You may no longer see some fields of this result', fields: err.fields } },
        { status: 403 },
      )
    }
    throw err
  }
  const result: ExecutionResult = {
    mode: 'sync',
    rows: execution.resultJson,
    total: typeof meta.total === 'number' ? meta.total : execution.resultJson.length,
    meta: {
      duration_ms: meta.duration_ms ?? 0,
      truncated: Boolean(meta.truncated),
      cap: meta.cap ?? execution.resultJson.length,
      fields: meta.fields,
      columns: meta.columns as ReportColumnDescriptor[] | undefined,
    },
  }
  const artifact = serializeReportResult(definition, result, format, { sheetName: report.name })
  const filename = reportExportFilename(report.name || `report_${report.id.slice(0, 8)}`, format)
  return new NextResponse(typeof artifact.body === 'string' ? artifact.body : new Uint8Array(artifact.body), {
    status: 200,
    headers: {
      'content-type': artifact.contentType,
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
      'x-om-report-truncated': result.meta.truncated ? '1' : '0',
    },
  })
}

export const openApi = {
  tag: reportsTag,
  summary: 'Download an async report execution',
  methods: {
    GET: {
      summary: 'Download a completed async execution (csv / xlsx / json / xml / markdown)',
      tags: [reportsTag],
      responses: [{ status: 200, description: 'Serialized result file' }],
      errors: [
        { status: 400, description: 'Unsupported format', schema: reportsErrorSchema },
        { status: 403, description: 'Field ACL no longer allows this result', schema: reportsErrorSchema },
        { status: 404, description: 'Execution not found or not owned by the caller', schema: reportsErrorSchema },
        { status: 409, description: 'Execution not completed yet', schema: reportsErrorSchema },
      ],
    },
  },
}
