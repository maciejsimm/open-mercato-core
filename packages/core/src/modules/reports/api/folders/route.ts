import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { ReportFolder, ReportFolderShare } from '../../data/entities'
import { canViewFolder, resolveFolderPermission, type FolderAclContext } from '../../lib/folder-acl'
import { reportsTag, reportsErrorSchema } from '../openapi'

const listQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    kind: z.enum(['private', 'public']).optional(),
    parentFolderId: z.string().uuid().optional(),
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
    entity: ReportFolder,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'reports:folder' },
  actions: {
    create: {
      commandId: 'reports.folder.create',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { folderId: string }).folderId) }),
      status: 201,
    },
    update: {
      commandId: 'reports.folder.update',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'reports.folder.delete',
      response: () => ({ ok: true }),
    },
  },
})

async function ensureMyReportsRoot(opts: {
  em: EntityManager
  userId: string
  tenantId: string
  organizationId: string | null
}): Promise<void> {
  if (!opts.organizationId) return
  const existing = await opts.em.findOne(ReportFolder, {
    tenantId: opts.tenantId,
    organizationId: opts.organizationId,
    parentFolderId: null,
    kind: 'private',
    ownerUserId: opts.userId,
    deletedAt: null,
  } as Record<string, unknown>)
  if (existing) return
  const folder = opts.em.create(ReportFolder, {
    organizationId: opts.organizationId,
    tenantId: opts.tenantId,
    parentFolderId: null,
    ownerUserId: opts.userId,
    kind: 'private',
    name: 'My Reports',
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  opts.em.persist(folder)
  await opts.em.flush()
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = listQuerySchema.safeParse({
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    kind: url.searchParams.get('kind') ?? undefined,
    parentFolderId: url.searchParams.get('parentFolderId') ?? undefined,
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

  await ensureMyReportsRoot({
    em,
    userId: auth.sub,
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
  })

  const folders = await em.find(
    ReportFolder,
    {
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? undefined,
      deletedAt: null,
      ...(parsed.data.kind ? { kind: parsed.data.kind } : {}),
      ...(parsed.data.parentFolderId ? { parentFolderId: parsed.data.parentFolderId } : {}),
    } as Record<string, unknown>,
    { orderBy: { kind: 'ASC', position: 'ASC', name: 'ASC' } },
  )

  const folderIds = folders.map((f) => f.id)
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

  const visible = folders
    .map((f) => {
      const rec = {
        id: f.id,
        kind: f.kind,
        ownerUserId: f.ownerUserId ?? null,
        organizationId: f.organizationId,
        tenantId: f.tenantId,
      }
      const perm = resolveFolderPermission(rec, ctx)
      if (!perm) return null
      if (!canViewFolder(rec, ctx)) return null
      return {
        id: f.id,
        parentFolderId: f.parentFolderId ?? null,
        kind: f.kind,
        ownerUserId: f.ownerUserId ?? null,
        name: f.name,
        position: f.position,
        permission: perm,
        createdAt: f.createdAt?.toISOString() ?? null,
        updatedAt: f.updatedAt?.toISOString() ?? null,
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
  summary: 'Manage report folders',
  methods: {
    GET: {
      summary: 'List visible folders',
      tags: [reportsTag],
      query: listQuerySchema,
      responses: [{ status: 200, description: 'Folders visible to the caller' }],
      errors: [
        { status: 401, description: 'Authentication required', schema: reportsErrorSchema },
        { status: 400, description: 'Invalid query', schema: reportsErrorSchema },
      ],
    },
    POST: {
      summary: 'Create a folder',
      tags: [reportsTag],
      responses: [{ status: 201, description: 'Folder created' }],
    },
    PUT: {
      summary: 'Update a folder',
      tags: [reportsTag],
      responses: [{ status: 200, description: 'Folder updated' }],
    },
    DELETE: {
      summary: 'Soft-delete a folder',
      tags: [reportsTag],
      responses: [{ status: 200, description: 'Folder deleted' }],
    },
  },
}
