import { NextResponse } from 'next/server'
import { resolveReportsRequestAccess } from '../../lib/access'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ReportEmbed } from '../../data/entities'
import { reportsTag, reportsErrorSchema } from '../openapi'

const listQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    /** Filter by widget spot id (e.g. `crud-form:customers.person:fields`). */
    spot: z.string().min(1).max(200).optional(),
    /** Filter by host entity id (e.g. `customers.person`). */
    hostEntityId: z.string().min(1).max(120).optional(),
    /** When `true`, hide rows where `enabled = false`. The record-embed-host widget passes this. */
    enabledOnly: z.coerce.boolean().optional(),
  })
  .passthrough()

const routeMetadata = {
  // GET is open to all viewers so widgets can fetch their config.
  GET: { requireAuth: true, requireFeatures: ['reports.view'] },
  POST: { requireAuth: true, requireFeatures: ['reports.embed.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['reports.embed.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['reports.embed.manage'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()
type CrudInput = Record<string, unknown>

const crud = makeCrudRoute<CrudInput, CrudInput, Record<string, unknown>>({
  metadata: routeMetadata,
  orm: {
    entity: ReportEmbed,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'reports:embed' },
  actions: {
    create: {
      commandId: 'reports.embed.create',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { embedId: string }).embedId) }),
      status: 201,
    },
    update: {
      commandId: 'reports.embed.update',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'reports.embed.delete',
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
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    id: url.searchParams.get('id') ?? undefined,
    spot: url.searchParams.get('spot') ?? undefined,
    hostEntityId: url.searchParams.get('hostEntityId') ?? undefined,
    enabledOnly: url.searchParams.get('enabledOnly') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 },
      { status: 400 },
    )
  }


  const where: Record<string, unknown> = {
    tenantId: access.tenantId,
    organizationId,
    deletedAt: null,
  }
  if (parsed.data.id) where.id = parsed.data.id
  if (parsed.data.spot) where.hostSpotId = parsed.data.spot
  if (parsed.data.hostEntityId) where.hostEntityId = parsed.data.hostEntityId
  if (parsed.data.enabledOnly) where.enabled = true

  const all = await em.find(ReportEmbed, where as any, {
    orderBy: { position: 'ASC', createdAt: 'ASC' },
    limit: parsed.data.pageSize,
    offset: (parsed.data.page - 1) * parsed.data.pageSize,
  })
  const total = await em.count(ReportEmbed, where as any)

  const items = all.map((e) => ({
    id: e.id,
    hostSpotId: e.hostSpotId,
    hostEntityId: e.hostEntityId,
    artifactType: e.artifactType,
    artifactId: e.artifactId,
    paramBindings: e.paramBindingsJson ?? {},
    displayTitle: e.displayTitle ?? null,
    position: e.position,
    enabled: e.enabled,
    createdAt: e.createdAt?.toISOString() ?? null,
    updatedAt: e.updatedAt?.toISOString() ?? null,
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
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const openApi = {
  tag: reportsTag,
  summary: 'Manage record-page embeds',
  methods: {
    GET: {
      summary: 'List embeds, optionally filtered by spot and host entity',
      description:
        'The record-embed-host widget calls this with `?spot=<spotId>&hostEntityId=<entity>&enabledOnly=1` to discover which reports/dashboards to render on a host page. Authoring tools pass no filter to see the full list.',
      tags: [reportsTag],
      query: listQuerySchema,
      responses: [{ status: 200, description: 'Embed list (paged)' }],
      errors: [{ status: 401, description: 'Authentication required', schema: reportsErrorSchema }],
    },
    POST: { summary: 'Create an embed', tags: [reportsTag], responses: [{ status: 201, description: 'Embed created' }] },
    PUT: { summary: 'Update an embed', tags: [reportsTag], responses: [{ status: 200, description: 'Embed updated' }] },
    DELETE: { summary: 'Delete an embed', tags: [reportsTag], responses: [{ status: 200, description: 'Embed deleted' }] },
  },
}
