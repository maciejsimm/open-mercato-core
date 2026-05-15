declare module '@/.mercato/generated/reports-datasets.generated' {
  import type { Dataset } from '@open-mercato/shared/modules/reports/dsl'

  export const reportsDatasetConfigEntries: Array<{
    moduleId: string
    datasets: Dataset[]
  }>
  export const allReportsDatasets: Dataset[]
  export function getReportsDataset(id: string): Dataset | undefined
  export function getReportsDatasetIds(): string[]
}
