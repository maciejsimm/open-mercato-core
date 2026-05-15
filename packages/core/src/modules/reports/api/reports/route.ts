import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { Report, ReportFolder, ReportFolderShare } from '../../data/entities'
import { canViewFolder, resolveArtifactPermission, type FolderAclContext } from '../../lib/folder-acl'
import { reportsTag, reportsErrorSchema } from '../openapi'

const listQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    folderId: z.string().uuid().optional(),
    datasetId: z.string().optional(),
    type: z.enum(['flat_list', 'grouped', 'pivot', 'chart', 'summary']).optional(),
    q: z.string().optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['reports.view'] },
  POST: { requireAuth: true, requireFeatures: ['reports.author'] },
  PUT: { requireAuth: true, requireFeatures: ['reports.author'] },
  DELETE: { requireAuth: true, requireFeatures: ['reports.author'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()
type CrudInput = Record<string, unknown>

const crud = makeCrudRoute<CrudInput, CrudInput, Record<string, unknown>>({
  metadata: routeMetadata,
  orm: {
    entity: Report,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'reports:report' },
  actions: {
    create: {
      commandId: 'reports.report.create',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { reportId: string }).reportId) }),
      status: 201,
    },
    update: {
      commandId: 'reports.report.update',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'reports.report.delete',
      response: () => ({ ok: true }),
    },
  },
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = listQuerySchema.safeParse({
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    id: url.searchParams.get('id') ?? undefined,
    folderId: url.searchParams.get('folderId') ?? undefined,
    datasetId: url.searchParams.get('datasetId') ?? undefined,
    type: url.searchParams.get('type') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const rbac = container.resolve('rbacService') as RbacService

  const aclData = await rbac.loadAcl(auth.sub, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
  })
  const userFeatures = new Set<string>(aclData.isSuperAdmin ? ['*'] : aclData.features)

  const where: Record<string, unknown> = {
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? undefined,
    deletedAt: null,
  }
  if (parsed.data.id) where.id = parsed.data.id
  if (parsed.data.folderId) where.folderId = parsed.data.folderId
  if (parsed.data.datasetId) where.datasetId = parsed.data.datasetId
  if (parsed.data.type) where.type = parsed.data.type
  if (parsed.data.q) where.name = { $ilike: `%${parsed.data.q}%` }

  const all = await em.find(Report, where as any, { orderBy: { updatedAt: 'DESC' } })

  const folderIds = Array.from(new Set(all.map((r) => r.folderId)))
  const folders = folderIds.length
    ? await em.find(ReportFolder, { id: { $in: folderIds } } as Record<string, unknown>)
    : []
  const folderById = new Map(folders.map((f) => [f.id, f]))
  const shares = folderIds.length
    ? await em.find(ReportFolderShare, { folderId: { $in: folderIds } } as Record<string, unknown>)
    : []

  const ctx: FolderAclContext = {
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

  const visible = all
    .map((r) => {
      const folder = folderById.get(r.folderId)
      if (!folder) return null
      const folderRec = {
        id: folder.id,
        kind: folder.kind,
        ownerUserId: folder.ownerUserId ?? null,
        organizationId: folder.organizationId,
        tenantId: folder.tenantId,
      }
      if (!canViewFolder(folderRec, ctx)) return null
      const perm = resolveArtifactPermission({
        folder: folderRec,
        artifactOwnerUserId: r.ownerUserId,
        ctx,
      })
      if (!perm) return null
      return {
        id: r.id,
        name: r.name,
        description: r.description ?? null,
        type: r.type,
        datasetId: r.datasetId,
        folderId: r.folderId,
        ownerUserId: r.ownerUserId,
        visibility: folder.kind,
        permission: perm,
        definition: r.definitionJson ?? null,
        parameters: r.parametersJson ?? [],
        version: r.version,
        lastExecutedAt: r.lastExecutedAt?.toISOString() ?? null,
        createdAt: r.createdAt?.toISOString() ?? null,
        updatedAt: r.updatedAt?.toISOString() ?? null,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  const total = visible.length
  const start = (parsed.data.page - 1) * parsed.data.pageSize
  const items = visible.slice(start, start + parsed.data.pageSize)
  return NextResponse.json({
    items,
    total,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    totalPages: Math.max(1, Math.ceil(total / parsed.data.pageSize)),
  })
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const openApi = {
  tag: reportsTag,
  summary: 'Manage reports',
  methods: {
    GET: {
      summary: 'List visible reports',
      tags: [reportsTag],
      query: listQuerySchema,
      responses: [{ status: 200, description: 'Reports visible to the caller (folder ACL applied)' }],
      errors: [{ status: 401, description: 'Authentication required', schema: reportsErrorSchema }],
    },
    POST: { summary: 'Create a report', tags: [reportsTag], responses: [{ status: 201, description: 'Report created' }] },
    PUT: { summary: 'Update a report', tags: [reportsTag], responses: [{ status: 200, description: 'Report updated' }] },
    DELETE: { summary: 'Delete a report', tags: [reportsTag], responses: [{ status: 200, description: 'Report deleted' }] },
  },
}
