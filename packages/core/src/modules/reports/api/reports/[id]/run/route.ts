import { NextResponse } from 'next/server'
import { resolveReportsRequestAccess } from '../../../../lib/access'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { ReportDefinition, ParameterDef } from '@open-mercato/shared/modules/reports/dsl'
import { Report, ReportFolder, ReportFolderShare } from '../../../../data/entities'
import { reportRunSchema } from '../../../../data/validators'
import { loadDataset } from '../../../../lib/datasets-registry'
import { estimateReportRows, shouldDispatchAsync } from '../../../../lib/execute'
import { dispatchAsyncRun } from '../../../../lib/async-run'
import { FieldAclDeniedError } from '../../../../lib/field-redact'
import { executeReportCached, type ReportsCacheService } from '../../../../lib/result-cache'
import { canViewFolder, resolveArtifactPermission, type FolderAclContext } from '../../../../lib/folder-acl'
import { reportsTag, reportsErrorSchema } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['reports.view'] },
}

export async function POST(req: Request, ctx: { params?: { id?: string } }) {
  const reportId = ctx.params?.id
  if (!reportId) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'report id is required' } },
      { status: 400 },
    )
  }

  const resolved = await resolveReportsRequestAccess(req)
  if (!resolved.ok) return resolved.response
  const { auth, access, container, em } = resolved
  const organizationId = access.organizationId

  let body: unknown = {}
  try {
    if (req.headers.get('content-length') !== '0') body = await req.json()
  } catch {
    body = {}
  }
  const parsedBody = reportRunSchema.safeParse(body ?? {})
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid run body' } },
      { status: 400 },
    )
  }


  const userFeatures = access.userFeatures

  const report = await em.findOne(Report, {
    id: reportId,
    tenantId: access.tenantId,
    organizationId,
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
    tenantId: access.tenantId,
    organizationId,
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
    userId: access.userId,
    roleIds: access.roleIds,
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

  const params = parsedBody.data.params ?? {}
  const requestedMode = parsedBody.data.mode
  const parameterDefs = (report.parametersJson as ParameterDef[] | undefined) ?? undefined

  const queryEngine = container.resolve('queryEngine') as QueryEngine
  const executionInput = {
    dataset,
    definition,
    userFeatures,
    userId: access.userId,
    tenantId: access.tenantId,
    organizationId,
    params,
    parameterDefs,
    page: parsedBody.data.page,
  }

  // Size probe (pageSize: 1 → total) decides sync vs async, so over-cap
  // reports never aggregate a silently truncated row set in the request.
  let estimatedRows = 0
  try {
    estimatedRows = requestedMode === 'async' ? 0 : await estimateReportRows(queryEngine, executionInput)
  } catch (err) {
    if (!(err instanceof FieldAclDeniedError)) throw err
  }
  const asyncDecision =
    definition.type === 'flat_list' && requestedMode !== 'async'
      ? null
      : shouldDispatchAsync(estimatedRows, requestedMode)
  if (asyncDecision) {
    const executionId = await dispatchAsyncRun({ em, report, access, params })
    return NextResponse.json(
      {
        mode: 'async',
        executionId,
        reason: asyncDecision.reason,
        estimatedRows: asyncDecision.estimatedRows,
        cap: asyncDecision.cap,
      },
      { status: 202 },
    )
  }

  let cacheService: ReportsCacheService | null = null
  try {
    cacheService = container.resolve('cacheService') as ReportsCacheService
  } catch {
    cacheService = null
  }
  try {
    const out = await executeReportCached(
      queryEngine,
      executionInput,
      {
        cache: cacheService,
        reportId: report.id,
        dataset,
      },
    )
    report.lastExecutedAt = new Date()
    await em.flush()
    return NextResponse.json({
      mode: 'sync',
      executionId: report.id,
      rows: out.rows,
      total: out.total,
      meta: out.meta,
    })
  } catch (err) {
    if (err instanceof FieldAclDeniedError) {
      return NextResponse.json(
        {
          error: {
            code: err.code,
            message: 'You cannot run this report because it references fields you may not see',
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
  summary: 'Execute a report',
  methods: {
    POST: {
      summary: 'Run a report synchronously',
      description:
        'Resolves parameters, applies field-level ACL against the **running** user, translates to a QueryEngine call and returns rows + totals. Supports flat_list directly and grouped/pivot/chart/summary through the in-memory aggregator (capped by OM_REPORTS_INMEMORY_CAP, default 25 000 rows).',
      tags: [reportsTag],
      responses: [
        { status: 200, description: 'Sync execution result' },
        { status: 202, description: 'Dispatched to the async worker (over the in-memory cap, or mode=async); poll GET /api/reports/executions/:executionId' },
      ],
      errors: [
        { status: 400, description: 'Invalid run body', schema: reportsErrorSchema },
        { status: 401, description: 'Auth required', schema: reportsErrorSchema },
        { status: 403, description: 'Field-ACL or folder ACL denied', schema: reportsErrorSchema },
        { status: 404, description: 'Report or dataset not found', schema: reportsErrorSchema },
      ],
    },
  },
}
