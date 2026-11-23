import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ReportExecution } from '../../../data/entities'
import { resolveReportsRequestAccess } from '../../../lib/access'
import { isReportsAdmin } from '../../../lib/folder-acl'
import { reportsTag, reportsErrorSchema } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['reports.view'] },
}

const executionStatusSchema = z.object({
  id: z.string().uuid(),
  reportId: z.string().uuid(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  rowCount: z.number().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  error: z.string().nullable(),
})

/** Status of an async execution. Visible to its requester (or reports.admin). */
export async function GET(req: Request, ctx: { params?: { id?: string } }) {
  const executionId = ctx.params?.id
  if (!executionId || !z.string().uuid().safeParse(executionId).success) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'execution id is required' } }, { status: 400 })
  }
  const resolved = await resolveReportsRequestAccess(req)
  if (!resolved.ok) return resolved.response
  const { access, em } = resolved
  const execution = await em.findOne(ReportExecution, {
    id: executionId,
    tenantId: access.tenantId,
    organizationId: access.organizationId,
  } as Record<string, unknown>)
  if (!execution || (execution.requestedByUserId !== access.userId && !isReportsAdmin(access.userFeatures))) {
    return NextResponse.json({ error: { code: 'REPORT_EXECUTION_NOT_FOUND', message: 'Execution not found' } }, { status: 404 })
  }
  return NextResponse.json({
    id: execution.id,
    reportId: execution.reportId,
    status: execution.status,
    rowCount: execution.rowCount ?? null,
    startedAt: execution.startedAt?.toISOString() ?? null,
    completedAt: execution.completedAt?.toISOString() ?? null,
    error: execution.errorText ?? null,
  })
}

export const openApi = {
  tag: reportsTag,
  summary: 'Async report execution status',
  methods: {
    GET: {
      summary: 'Get an async execution status',
      tags: [reportsTag],
      responses: [{ status: 200, description: 'Execution status', schema: executionStatusSchema }],
      errors: [
        { status: 400, description: 'Invalid execution id', schema: reportsErrorSchema },
        { status: 404, description: 'Execution not found or not owned by the caller', schema: reportsErrorSchema },
      ],
    },
  },
}
