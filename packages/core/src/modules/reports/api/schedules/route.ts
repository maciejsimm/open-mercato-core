import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ReportSchedule } from '../../data/entities'
import { reportsTag, reportsErrorSchema } from '../openapi'

const listQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    reportId: z.string().uuid().optional(),
    enabledOnly: z.coerce.boolean().optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['reports.schedule'] },
  POST: { requireAuth: true, requireFeatures: ['reports.schedule'] },
  PUT: { requireAuth: true, requireFeatures: ['reports.schedule'] },
  DELETE: { requireAuth: true, requireFeatures: ['reports.schedule'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()
type CrudInput = Record<string, unknown>

const crud = makeCrudRoute<CrudInput, CrudInput, Record<string, unknown>>({
  metadata: routeMetadata,
  orm: {
    entity: ReportSchedule,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'reports:schedule' },
  actions: {
    create: {
      commandId: 'reports.schedule.create',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { scheduleId: string }).scheduleId) }),
      status: 201,
    },
    update: {
      commandId: 'reports.schedule.update',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'reports.schedule.delete',
      response: () => ({ ok: true }),
    },
  },
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json(
      { items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 },
      { status: 401 },
    )
  }

  const url = new URL(req.url)
  const parsed = listQuerySchema.safeParse({
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    id: url.searchParams.get('id') ?? undefined,
    reportId: url.searchParams.get('reportId') ?? undefined,
    enabledOnly: url.searchParams.get('enabledOnly') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const where: Record<string, unknown> = {
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? undefined,
    deletedAt: null,
  }
  if (parsed.data.id) where.id = parsed.data.id
  if (parsed.data.reportId) where.reportId = parsed.data.reportId
  if (parsed.data.enabledOnly) where.enabled = true

  const all = await em.find(ReportSchedule, where as any, {
    orderBy: { createdAt: 'DESC' },
    limit: parsed.data.pageSize,
    offset: (parsed.data.page - 1) * parsed.data.pageSize,
  })
  const total = await em.count(ReportSchedule, where as any)

  const items = all.map((s) => ({
    id: s.id,
    reportId: s.reportId,
    name: s.name,
    cadence: s.cadence,
    timezone: s.timezone,
    recipients: s.recipientsJson ?? [],
    params: s.paramsJson ?? {},
    formats: s.formatsJson ?? ['csv'],
    enabled: s.enabled,
    lastRunAt: s.lastRunAt?.toISOString() ?? null,
    nextRunAt: s.nextRunAt?.toISOString() ?? null,
    failureCount: s.failureCount,
    createdAt: s.createdAt?.toISOString() ?? null,
    updatedAt: s.updatedAt?.toISOString() ?? null,
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
  summary: 'Manage report schedules',
  methods: {
    GET: { summary: 'List schedules', tags: [reportsTag], query: listQuerySchema, responses: [{ status: 200, description: 'Schedules (paged)' }], errors: [{ status: 401, description: 'Authentication required', schema: reportsErrorSchema }] },
    POST: { summary: 'Create a schedule', tags: [reportsTag], responses: [{ status: 201, description: 'Schedule created' }] },
    PUT: { summary: 'Update a schedule', tags: [reportsTag], responses: [{ status: 200, description: 'Schedule updated' }] },
    DELETE: { summary: 'Delete a schedule', tags: [reportsTag], responses: [{ status: 200, description: 'Schedule deleted' }] },
  },
}
