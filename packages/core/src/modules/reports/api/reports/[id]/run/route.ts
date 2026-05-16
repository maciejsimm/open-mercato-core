import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { ReportDefinition, ParameterDef } from '@open-mercato/shared/modules/reports/dsl'
import { Report, ReportFolder, ReportFolderShare } from '../../../../data/entities'
import { reportRunSchema } from '../../../../data/validators'
import { loadDataset } from '../../../../lib/datasets-registry'
import { shouldDispatchAsync } from '../../../../lib/execute'
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

  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 },
    )
  }

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

  const params = parsedBody.data.params ?? {}
  const requestedMode = parsedBody.data.mode
  const parameterDefs = (report.parametersJson as ParameterDef[] | undefined) ?? undefined

  // Async dispatch heuristic — Phase 1 returns 202 telling the client to retry
  // once the Phase 4 worker is available. The execute orchestrator still does
  // its own truncation check below.
  const asyncDecision = shouldDispatchAsync(0, requestedMode)
  if (asyncDecision && asyncDecision.reason === 'requested') {
    return NextResponse.json(
      {
        mode: 'async',
        executionId: report.id,
        progressJobId: null,
        message: 'Async dispatch is wired in Phase 4. The current request would have been queued.',
      },
      { status: 202 },
    )
  }

  const queryEngine = container.resolve('queryEngine') as QueryEngine
  let cacheService: ReportsCacheService | null = null
  try {
    cacheService = container.resolve('cacheService') as ReportsCacheService
  } catch {
    cacheService = null
  }
  try {
    const out = await executeReportCached(
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
        { status: 202, description: 'Async dispatch (Phase 4)' },
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
