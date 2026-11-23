import { hasAnyReportFeature } from './feature-access'
import type { Dataset } from '@open-mercato/shared/modules/reports/dsl'

export type DatasetSource = {
  list(): Dataset[]
  get(id: string): Dataset | undefined
  ids(): string[]
}

let cachedSource: DatasetSource | null = null

/**
 * Override the source (used by tests). Pass `null` to fall back to the
 * generated registry.
 */
export function __setDatasetSource(source: DatasetSource | null): void {
  cachedSource = source
}

async function resolveSource(): Promise<DatasetSource> {
  if (cachedSource) return cachedSource
  const mod = (await import('@/.mercato/generated/reports-datasets.generated')) as {
    allReportsDatasets: Dataset[]
    getReportsDataset: (id: string) => Dataset | undefined
    getReportsDatasetIds: () => string[]
  }
  return {
    list: () => mod.allReportsDatasets,
    get: (id) => mod.getReportsDataset(id),
    ids: () => mod.getReportsDatasetIds(),
  }
}

/**
 * Load every dataset visible to a user with `userFeatures`.
 * Filters by `dataset.requiredFeatures` (any-of). Datasets with no
 * required features are visible to everyone.
 */
export async function listVisibleDatasets(userFeatures: ReadonlySet<string>): Promise<Dataset[]> {
  const src = await resolveSource()
  return src.list().filter((d) => isDatasetVisible(d, userFeatures))
}

/**
 * Resolve a single dataset by id, returning undefined when the user is
 * not allowed to see it (404-ish; the caller decides on the response shape).
 */
export async function loadDataset(
  id: string,
  userFeatures: ReadonlySet<string>,
): Promise<Dataset | undefined> {
  const src = await resolveSource()
  const ds = src.get(id)
  if (!ds) return undefined
  return isDatasetVisible(ds, userFeatures) ? ds : undefined
}

export function isDatasetVisible(dataset: Dataset, userFeatures: ReadonlySet<string>): boolean {
  const required = dataset.requiredFeatures
  if (!required?.length) return true
  return hasAnyReportFeature(userFeatures, required)
}
