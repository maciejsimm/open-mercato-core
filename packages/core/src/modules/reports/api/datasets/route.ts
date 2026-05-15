import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { Dataset } from '@open-mercato/shared/modules/reports/dsl'
import { listVisibleDatasets } from '../../lib/datasets-registry'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['reports.author'] },
}

type DatasetSummary = {
  id: string
  moduleId: string
  labelKey: string
  descriptionKey: string | null
  entityType: string
  fieldCount: number
  joinCount: number
}

function summarize(dataset: Dataset): DatasetSummary {
  return {
    id: dataset.id,
    moduleId: dataset.moduleId,
    labelKey: dataset.labelKey,
    descriptionKey: dataset.descriptionKey ?? null,
    entityType: dataset.entityType,
    fieldCount: dataset.fields.length,
    joinCount: dataset.joins?.length ?? 0,
  }
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, { status: 401 })
  }

  const container = await createRequestContainer()
  const rbac = container.resolve('rbacService') as RbacService
  const acl = await rbac.loadAcl(auth.sub, { tenantId: auth.tenantId, organizationId: auth.orgId ?? null })
  const userFeatures = new Set<string>(acl.isSuperAdmin ? ['*'] : acl.features)

  const datasets = await listVisibleDatasets(userFeatures)
  return NextResponse.json({ items: datasets.map(summarize), total: datasets.length })
}

export const openApi = {
  GET: {
    summary: 'List visible reports datasets',
    description:
      'Returns the datasets the caller can author reports against. Each dataset is a curated, RBAC-aware projection over an indexed entity declared in <module>/reports.ts.',
    tags: ['Reports'],
    responses: {
      200: { description: 'Datasets visible to the caller' },
      401: { description: 'Unauthorized' },
    },
  },
}
