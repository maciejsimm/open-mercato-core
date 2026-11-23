import { NextResponse } from 'next/server'
import { resolveReportsRequestAccess } from '../../lib/access'
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
  const resolved = await resolveReportsRequestAccess(req)
  if (!resolved.ok) return resolved.response
  const { auth, access, container, em } = resolved
  const organizationId = access.organizationId

  const userFeatures = access.userFeatures

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
