import { NextResponse } from 'next/server'
import { resolveReportsRequestAccess } from '../../../../lib/access'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { ParameterDef, ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import { Report, ReportDashboard, ReportFolder, ReportFolderShare } from '../../../../data/entities'
import { dashboardLayoutSchema, dashboardRunSchema, type DashboardLayoutInput, type DashboardTileInput } from '../../../../data/validators'
import { loadDataset } from '../../../../lib/datasets-registry'
import { FieldAclDeniedError } from '../../../../lib/field-redact'
import { executeReportCached, type ReportsCacheService } from '../../../../lib/result-cache'
import { canViewFolder, resolveArtifactPermission, type FolderAclContext } from '../../../../lib/folder-acl'
import { reportsTag, reportsErrorSchema } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['reports.view'] },
}

type TileResult =
  | { tileId: string; reportId: string; mode: string; rows: Record<string, unknown>[]; total: number; meta: Record<string, unknown> }
  | { tileId: string; reportId: string; mode: string; error: { code: string; message: string; fields?: string[] } }

export async function POST(req: Request, ctx: { params?: { id?: string } }) {
  const dashboardId = ctx.params?.id
  if (!dashboardId) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'dashboard id is required' } },
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
  const parsedBody = dashboardRunSchema.safeParse(body ?? {})
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid run body' } },
      { status: 400 },
    )
  }


  const userFeatures = access.userFeatures

  const dashboard = await em.findOne(ReportDashboard, {
    id: dashboardId,
    tenantId: access.tenantId,
    organizationId,
    deletedAt: null,
  } as Record<string, unknown>)
  if (!dashboard) {
    return NextResponse.json(
      { error: { code: 'DASHBOARD_NOT_FOUND', message: 'Dashboard not found' } },
      { status: 404 },
    )
  }

  const folder = await em.findOne(ReportFolder, {
    id: dashboard.folderId,
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
    !resolveArtifactPermission({ folder: folderRec, artifactOwnerUserId: dashboard.ownerUserId, ctx: aclCtx })
  ) {
    return NextResponse.json(
      { error: { code: 'REPORT_FOLDER_FORBIDDEN', message: 'You do not have access to this dashboard' } },
      { status: 403 },
    )
  }

  const parsedLayout = dashboardLayoutSchema.safeParse(dashboard.layoutJson ?? { tiles: [] })
  if (!parsedLayout.success) {
    return NextResponse.json(
      { error: { code: 'DASHBOARD_LAYOUT_INVALID', message: 'Stored dashboard layout failed validation' } },
      { status: 500 },
    )
  }
  const layout: DashboardLayoutInput = parsedLayout.data
  const dashboardParams = parsedBody.data.params ?? {}

  const queryEngine = container.resolve('queryEngine') as QueryEngine
  let cacheService: ReportsCacheService | null = null
  try {
    cacheService = container.resolve('cacheService') as ReportsCacheService
  } catch {
    cacheService = null
  }
  const now = new Date()
  const tenantId = access.tenantId

  const tilePromises = layout.tiles.map((tile) =>
    runTile(tile, {
      em,
      tenantId,
      organizationId,
      userFeatures,
      userId: access.userId,
      queryEngine,
      cacheService,
      now,
      dashboardParams,
    }),
  )
  const results = await Promise.all(tilePromises)

  dashboard.lastExecutedAt = new Date()
  await em.flush()

  return NextResponse.json({
    mode: 'sync',
    executionId: dashboard.id,
    tiles: results,
  })
}

type RunTileContext = {
  em: EntityManager
  tenantId: string
  organizationId: string
  userFeatures: ReadonlySet<string>
  userId: string
  queryEngine: QueryEngine
  cacheService: ReportsCacheService | null
  now: Date
  dashboardParams: Record<string, unknown>
}

async function runTile(tile: DashboardTileInput, ctx: RunTileContext): Promise<TileResult> {
  try {
    const report = await ctx.em.findOne(Report, {
      id: tile.reportId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    } as Record<string, unknown>)
    if (!report) {
      return tileError(tile, 'REPORT_NOT_FOUND', 'The report referenced by this tile no longer exists.')
    }
    const dataset = await loadDataset(report.datasetId, ctx.userFeatures)
    if (!dataset) {
      return tileError(tile, 'REPORT_DATASET_NOT_FOUND', `Dataset '${report.datasetId}' not visible to caller`)
    }
    const definition = report.definitionJson as ReportDefinition
    const parameterDefs = (report.parametersJson as ParameterDef[] | undefined) ?? undefined

    const params = mergeTileParams(ctx.dashboardParams, tile.paramBindings)

    const out = await executeReportCached(
      ctx.queryEngine,
      {
        dataset,
        definition,
        userFeatures: ctx.userFeatures,
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        params,
        parameterDefs,
        now: ctx.now,
      },
      {
        cache: ctx.cacheService,
        reportId: report.id,
        dataset,
      },
    )
    return {
      tileId: tile.id,
      reportId: tile.reportId,
      mode: tile.mode,
      rows: out.rows,
      total: out.total,
      meta: { ...out.meta, fields: out.meta.fields ?? undefined },
    }
  } catch (err) {
    if (err instanceof FieldAclDeniedError) {
      return {
        tileId: tile.id,
        reportId: tile.reportId,
        mode: tile.mode,
        error: { code: err.code, message: 'Insufficient access', fields: err.fields },
      }
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return tileError(tile, 'TILE_FAILED', message)
  }
}

function tileError(tile: DashboardTileInput, code: string, message: string): TileResult {
  return { tileId: tile.id, reportId: tile.reportId, mode: tile.mode, error: { code, message } }
}

/**
 * Merge dashboard-level params with per-tile param bindings. The tile bindings
 * are evaluated per-source:
 * - `literal`     → the literal value wins.
 * - `parameter`   → look up the value in the dashboard params map.
 * - `record-field`→ ignored at run-time (only meaningful for record-embed-host).
 */
function mergeTileParams(
  dashboardParams: Record<string, unknown>,
  bindings: DashboardTileInput['paramBindings'],
): Record<string, unknown> {
  if (!bindings) return { ...dashboardParams }
  const out: Record<string, unknown> = { ...dashboardParams }
  for (const [paramKey, binding] of Object.entries(bindings)) {
    if (binding.source === 'literal') {
      out[paramKey] = binding.value
    } else if (binding.source === 'parameter') {
      const source = binding.parameter
      if (dashboardParams[source] !== undefined) out[paramKey] = dashboardParams[source]
    }
    // 'record-field' is a no-op here; it's resolved by record-embed-host (Step 3.11).
  }
  return out
}

export const openApi = {
  tag: reportsTag,
  summary: 'Run a dashboard',
  methods: {
    POST: {
      summary: 'Execute every tile of a dashboard in parallel',
      description:
        'Resolves dashboard-level params, fans out to every tile through `executeReport`, and returns one entry per tile. A tile that fails (missing report, field-ACL denial, etc.) returns `{ error: { code, message } }` instead of `rows`; one bad tile does not fail the whole dashboard.',
      tags: [reportsTag],
      responses: [{ status: 200, description: 'Per-tile execution payload' }],
      errors: [
        { status: 400, description: 'Invalid body or stored layout', schema: reportsErrorSchema },
        { status: 401, description: 'Auth required', schema: reportsErrorSchema },
        { status: 403, description: 'Folder ACL denied', schema: reportsErrorSchema },
        { status: 404, description: 'Dashboard not found', schema: reportsErrorSchema },
      ],
    },
  },
}
