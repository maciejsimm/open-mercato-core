import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { loadDataset } from '../../../lib/datasets-registry'
import { redactDatasetFields } from '../../../lib/field-redact'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['reports.author'] },
}

export async function GET(req: Request, ctx: { params?: { id?: string } }) {
  const id = ctx.params?.id
  if (!id || typeof id !== 'string') {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'dataset id is required' } },
      { status: 400 },
    )
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, { status: 401 })
  }

  const container = await createRequestContainer()
  const rbac = container.resolve('rbacService') as RbacService
  const acl = await rbac.loadAcl(auth.sub, { tenantId: auth.tenantId, organizationId: auth.orgId ?? null })
  const userFeatures = new Set<string>(acl.isSuperAdmin ? ['*'] : acl.features)

  const dataset = await loadDataset(id, userFeatures)
  if (!dataset) {
    return NextResponse.json(
      { error: { code: 'REPORT_DATASET_NOT_FOUND', message: `Dataset '${id}' not found or not visible` } },
      { status: 404 },
    )
  }

  const redacted = redactDatasetFields(dataset, userFeatures)

  return NextResponse.json({
    id: redacted.id,
    moduleId: redacted.moduleId,
    labelKey: redacted.labelKey,
    descriptionKey: redacted.descriptionKey ?? null,
    entityType: redacted.entityType,
    fields: redacted.visibleFields,
    joins: redacted.joins ?? [],
    defaultSort: redacted.defaultSort ?? [],
    defaultPageSize: redacted.defaultPageSize ?? null,
    parameters: redacted.parameters ?? [],
    hiddenFieldPaths: redacted.hiddenFieldPaths,
  })
}

export const openApi = {
  GET: {
    summary: 'Get a reports dataset',
    description:
      'Returns one dataset with fields filtered by the caller\'s ACL. Hidden fields appear in `hiddenFieldPaths` so the builder can show a tooltip explaining the required feature.',
    tags: ['Reports'],
    responses: {
      200: { description: 'Dataset detail (fields ACL-filtered)' },
      401: { description: 'Unauthorized' },
      404: { description: 'Dataset not found or not visible to the caller' },
    },
  },
}
