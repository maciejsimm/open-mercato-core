import { NextResponse } from 'next/server'
import { buildFolderAclContext, resolveReportsRequestAccess } from '../../lib/access'
import { canShareFolder } from '../../lib/folder-acl'
import { loadFolderRecord, loadFolderShares } from '../../commands/shared'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ReportFolderShare } from '../../data/entities'
import { reportsTag, reportsErrorSchema } from '../openapi'

const listQuerySchema = z
  .object({
    folderId: z.string().uuid(),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['reports.share'] },
  POST: { requireAuth: true, requireFeatures: ['reports.share'] },
  DELETE: { requireAuth: true, requireFeatures: ['reports.share'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()
type CrudInput = Record<string, unknown>

const crud = makeCrudRoute<CrudInput, CrudInput, Record<string, unknown>>({
  metadata: routeMetadata,
  orm: {
    entity: ReportFolderShare,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: null,
  },
  indexer: { entityType: 'reports:folder_share' },
  actions: {
    create: {
      commandId: 'reports.folder.share',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { shareId: string }).shareId) }),
      status: 201,
    },
    delete: {
      commandId: 'reports.folder.share.delete',
      response: () => ({ ok: true }),
    },
  },
})

export async function GET(req: Request) {
  const resolved = await resolveReportsRequestAccess(req)
  if (!resolved.ok) return resolved.response
  const { auth, access, container, em } = resolved
  const organizationId = access.organizationId

  const url = new URL(req.url)
  const parsed = listQuerySchema.safeParse({
    folderId: url.searchParams.get('folderId') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'folderId is required' } },
      { status: 400 },
    )
  }


  const folder = await loadFolderRecord(em, parsed.data.folderId, access.tenantId, organizationId)
  const folderShares = folder ? await loadFolderShares(em, folder.id) : []
  if (!folder || !canShareFolder(folder, buildFolderAclContext(access, folderShares))) {
    return NextResponse.json(
      { error: { code: 'REPORT_FOLDER_FORBIDDEN', message: 'You cannot manage sharing for this folder' } },
      { status: 403 },
    )
  }

  const shares = await em.find(
    ReportFolderShare,
    {
      folderId: parsed.data.folderId,
      tenantId: access.tenantId,
      organizationId,
    } as Record<string, unknown>,
    { orderBy: { createdAt: 'ASC' } },
  )
  const total = shares.length
  const start = (parsed.data.page - 1) * parsed.data.pageSize
  const items = shares.slice(start, start + parsed.data.pageSize).map((s) => ({
    id: s.id,
    folderId: s.folderId,
    principalType: s.principalType,
    principalId: s.principalId,
    permission: s.permission,
    grantedByUserId: s.grantedByUserId,
    createdAt: s.createdAt?.toISOString() ?? null,
  }))
  return NextResponse.json({
    items,
    total,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    totalPages: Math.max(1, Math.ceil(total / parsed.data.pageSize)),
  })
}

export const POST = crud.POST
export const DELETE = crud.DELETE

export const openApi = {
  tag: reportsTag,
  summary: 'Manage folder shares (private folders only)',
  methods: {
    GET: {
      summary: 'List shares on a folder',
      tags: [reportsTag],
      query: listQuerySchema,
      responses: [{ status: 200, description: 'Shares' }],
      errors: [{ status: 401, description: 'Auth required', schema: reportsErrorSchema }],
    },
    POST: {
      summary: 'Add a share',
      tags: [reportsTag],
      responses: [{ status: 201, description: 'Share created' }],
    },
    DELETE: {
      summary: 'Remove a share',
      tags: [reportsTag],
      responses: [{ status: 200, description: 'Share removed' }],
    },
  },
}
