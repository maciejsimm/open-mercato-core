import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { ParameterDef, ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import {
  defaultExportFilename,
  normalizeExportFormat,
  type CrudExportFormat,
} from '@open-mercato/shared/lib/crud/exporters'
import { Report, ReportFolder, ReportFolderShare } from '../../../../data/entities'
import { loadDataset } from '../../../../lib/datasets-registry'
import { runReportExport } from '../../../../lib/export'
import { FieldAclDeniedError } from '../../../../lib/field-redact'
import { canViewFolder, resolveArtifactPermission, type FolderAclContext } from '../../../../lib/folder-acl'
import { reportsTag, reportsErrorSchema } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['reports.view'] },
}

const supportedFormats: CrudExportFormat[] = ['csv', 'json', 'xml', 'markdown']

const paramsQuerySchema = z.record(z.string(), z.string()).optional()

export async function GET(req: Request, ctx: { params?: { id?: string } }) {
  const reportId = ctx.params?.id
  if (!reportId) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'report id is required' } },
      { status: 400 },
    )
  }

  const url = new URL(req.url)
  const rawFormat = url.searchParams.get('format')
  const format = normalizeExportFormat(rawFormat) ?? 'csv'
  if (!supportedFormats.includes(format)) {
    return NextResponse.json(
      {
        error: {
          code: 'REPORT_EXPORT_FORMAT_UNSUPPORTED',
          message: `Format '${format}' is not supported yet. Supported: ${supportedFormats.join(', ')}. XLSX ships in Step 3.6b.`,
        },
      },
      { status: 400 },
    )
  }

  // Collect parameter values from the query string (everything that is not
  // `format`). The convention matches the run route's body-shaped params map.
  const params: Record<string, unknown> = {}
  for (const [key, value] of url.searchParams.entries()) {
    if (key === 'format') continue
    params[key] = value
  }
  // Validate shape — schema is opt-in, this stays best-effort tolerant.
  paramsQuerySchema.safeParse(params)

  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 },
    )
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const rbac = container.resolve('rbacService') as RbacService

  const aclData = await rbac.loadAcl(auth.sub, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
  })
  const userFeatures = new Set<string>(aclData.isSuperAdmin ? ['*'] : aclData.features)

  const report = await em.findOne(Report, {
    id: reportId,
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? undefined,
    deletedAt: null,
  } as Record<string, unknown>)
  if (!report) {
    return NextResponse.json(
      { error: { code: 'REPORT_NOT_FOUND', message: 'Report not found' } },
      { status: 404 },
    )
  }

  const folder = await em.findOne(ReportFolder, {
    id: report.folderId,
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? undefined,
    deletedAt: null,
  } as Record<string, unknown>)
  if (!folder) {
    return NextResponse.json(
      { error: { code: 'REPORT_FOLDER_FORBIDDEN', message: 'Folder not found' } },
      { status: 403 },
    )
  }
  const shares = await em.find(ReportFolderShare, { folderId: folder.id } as Record<string, unknown>)
  const aclCtx: FolderAclContext = {
    userId: auth.sub,
    roleIds: new Set<string>(Array.isArray(auth.roles) ? auth.roles : []),
    userFeatures,
    shares: shares.map((s) => ({
      id: s.id,
      folderId: s.folderId,
      principalType: s.principalType,
      principalId: s.principalId,
      permission: s.permission,
    })),
  }
  const folderRec = {
    id: folder.id,
    kind: folder.kind,
    ownerUserId: folder.ownerUserId ?? null,
    organizationId: folder.organizationId,
    tenantId: folder.tenantId,
  }
  if (
    !canViewFolder(folderRec, aclCtx) ||
    !resolveArtifactPermission({ folder: folderRec, artifactOwnerUserId: report.ownerUserId, ctx: aclCtx })
  ) {
    return NextResponse.json(
      { error: { code: 'REPORT_FOLDER_FORBIDDEN', message: 'You do not have access to this report' } },
      { status: 403 },
    )
  }

  const dataset = await loadDataset(report.datasetId, userFeatures)
  if (!dataset) {
    return NextResponse.json(
      { error: { code: 'REPORT_DATASET_NOT_FOUND', message: `Dataset '${report.datasetId}' not found or not visible` } },
      { status: 404 },
    )
  }

  const definition = report.definitionJson as ReportDefinition
  const parameterDefs = (report.parametersJson as ParameterDef[] | undefined) ?? undefined

  const queryEngine = container.resolve('queryEngine') as QueryEngine
  try {
    const artifact = await runReportExport(
      queryEngine,
      {
        dataset,
        definition,
        userFeatures,
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? '',
        params,
        parameterDefs,
      },
      format,
    )
    report.lastExecutedAt = new Date()
    await em.flush()
    const filename = defaultExportFilename(report.name || `report_${report.id.slice(0, 8)}`, format)
    return new NextResponse(artifact.body, {
      status: 200,
      headers: {
        'content-type': artifact.contentType,
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
        'x-om-report-total': String(artifact.total),
        'x-om-report-cap': String(artifact.cap),
        'x-om-report-truncated': artifact.truncated ? '1' : '0',
      },
    })
  } catch (err) {
    if (err instanceof FieldAclDeniedError) {
      return NextResponse.json(
        {
          error: {
            code: err.code,
            message: 'You cannot export this report because it references fields you may not see',
            fields: err.fields,
          },
        },
        { status: 403 },
      )
    }
    throw err
  }
}

export const openApi = {
  tag: reportsTag,
  summary: 'Export a report',
  methods: {
    GET: {
      summary: 'Run a report and return the result as a file',
      description:
        'Resolves parameters, applies field-level ACL against the **running** user, runs the report through the executor (flat_list directly or via the in-memory aggregator), and serializes the rows to the requested format. Supports csv / json / xml / markdown today; XLSX ships in Step 3.6b.',
      tags: [reportsTag],
      responses: [
        { status: 200, description: 'Serialized report (Content-Disposition: attachment)' },
      ],
      errors: [
        { status: 400, description: 'Missing report id or unsupported format', schema: reportsErrorSchema },
        { status: 401, description: 'Auth required', schema: reportsErrorSchema },
        { status: 403, description: 'Field-ACL or folder ACL denied', schema: reportsErrorSchema },
        { status: 404, description: 'Report or dataset not found', schema: reportsErrorSchema },
      ],
    },
  },
}
