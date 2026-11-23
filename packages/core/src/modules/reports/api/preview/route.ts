import { NextResponse } from 'next/server'
import { resolveReportsRequestAccess } from '../../lib/access'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { ReportDefinition, ParameterDef } from '@open-mercato/shared/modules/reports/dsl'
import { reportPreviewSchema } from '../../data/validators'
import { loadDataset } from '../../lib/datasets-registry'
import { executeReport } from '../../lib/execute'
import { FieldAclDeniedError } from '../../lib/field-redact'
import { reportsTag, reportsErrorSchema } from '../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['reports.author'] },
}

const DEFAULT_PREVIEW_LIMIT = 10
const MAX_PREVIEW_LIMIT = 100

/**
 * Ad-hoc preview executor for the builder's live preview.
 *
 * Accepts a fully-formed (but unsaved) report definition + dataset id and
 * returns a small slice of rows. Differences vs `/api/reports/[id]/run`:
 *   - no `report` record involved, so no folder ACL check
 *   - definition comes from the request body, not the DB
 *   - hard caps `definition.limit` to `min(body.limit ?? 10, 100)` so the
 *     builder cannot accidentally run an expensive scan from every
 *     keystroke
 *   - gated by `reports.author` (same as builder access)
 *   - bypasses the result cache (each keystroke is a different shape)
 *
 * Field-level ACL still runs against the calling user, identical to /run.
 */
export async function POST(req: Request) {
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
  const parsed = reportPreviewSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid preview body',
          issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        },
      },
      { status: 400 },
    )
  }

  const userFeatures = access.userFeatures

  const dataset = await loadDataset(parsed.data.datasetId, userFeatures)
  if (!dataset) {
    return NextResponse.json(
      { error: { code: 'REPORT_DATASET_NOT_FOUND', message: `Dataset '${parsed.data.datasetId}' not found or not visible` } },
      { status: 404 },
    )
  }

  const requestedLimit = parsed.data.limit ?? DEFAULT_PREVIEW_LIMIT
  const limit = Math.min(Math.max(1, requestedLimit), MAX_PREVIEW_LIMIT)
  // Force the executor to cap rows at `limit` regardless of what the
  // saved/edited definition asks for. For flat_list/grouped/chart this is
  // honored via `definition.limit`; for pivot/summary the limit is
  // applied to the final row count.
  const definition = { ...(parsed.data.definition as ReportDefinition), limit } as ReportDefinition

  const queryEngine = container.resolve('queryEngine') as QueryEngine
  try {
    const out = await executeReport(queryEngine, {
      dataset,
      definition,
      userFeatures,
      userId: access.userId,
      tenantId: access.tenantId,
      organizationId,
      params: parsed.data.params ?? {},
      parameterDefs: parsed.data.parameters as ParameterDef[] | undefined,
      // Aggregates must scan the full result set (up to the env cap); only
      // the returned row count is trimmed to the preview limit.
      inMemoryCap: definition.type === 'flat_list' ? Math.max(limit, 100) : undefined,
    })
    const rows = Array.isArray(out.rows) ? out.rows.slice(0, limit) : []
    return NextResponse.json({
      mode: 'sync',
      rows,
      total: out.total,
      meta: { ...out.meta, previewLimit: limit, preview: true },
    })
  } catch (err) {
    if (err instanceof FieldAclDeniedError) {
      return NextResponse.json(
        {
          error: {
            code: err.code,
            message: 'Preview blocked: the definition references fields you may not see',
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
  summary: 'Preview an ad-hoc report definition',
  methods: {
    POST: {
      summary: 'Run an ad-hoc definition without persisting',
      description:
        'Executes a builder-supplied report definition against the requested dataset and returns a small row sample. Used by the report builder for the auto-refreshing live preview. Hard-capped at 100 rows.',
      tags: [reportsTag],
      responses: [
        { status: 200, description: 'Preview rows + meta' },
      ],
      errors: [
        { status: 400, description: 'Invalid preview body', schema: reportsErrorSchema },
        { status: 401, description: 'Auth required', schema: reportsErrorSchema },
        { status: 403, description: 'Field-ACL denied', schema: reportsErrorSchema },
        { status: 404, description: 'Dataset not visible', schema: reportsErrorSchema },
      ],
    },
  },
}
