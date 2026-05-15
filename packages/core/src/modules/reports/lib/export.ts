import type { Dataset, ParameterDef, ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import {
  serializeExport,
  type CrudExportColumn,
  type CrudExportFormat,
  type SerializedExport,
} from '@open-mercato/shared/lib/crud/exporters'
import { executeReport, type ExecutionResult } from './execute'
import { measureAlias } from './aggregator'

export type ReportExportInput = {
  dataset: Dataset
  definition: ReportDefinition
  /** Features of the **running** user (not the report owner). */
  userFeatures: ReadonlySet<string>
  tenantId: string
  organizationId: string
  /** Raw parameter values from the request body / URL / schedule frozen state. */
  params?: Record<string, unknown>
  /** Parameter declarations from the report (preferred). */
  parameterDefs?: ParameterDef[]
  /** Pin the clock when resolving relative date-range tokens. */
  now?: Date
  /** Optional override for the in-memory row cap. */
  inMemoryCap?: number
}

export type ReportExportArtifact = SerializedExport & {
  total: number
  cap: number
  truncated: boolean
}

/**
 * Build the column list used for export. For aggregated reports the executor
 * provides `meta.fields` (groupBy keys + measure aliases, or row keys + col
 * labels for pivot); for flat_list we read the definition's `fields`. As a
 * last resort the column list is inferred from the first row.
 */
export function pickExportColumns(
  definition: ReportDefinition,
  result: ExecutionResult,
): CrudExportColumn[] {
  if (result.meta.fields && result.meta.fields.length > 0) {
    return result.meta.fields.map((field) => ({ field, header: humanizeHeader(field) }))
  }
  if (definition.type === 'flat_list' && definition.fields.length > 0) {
    return definition.fields.map((field) => ({ field, header: humanizeHeader(field) }))
  }
  if (definition.type === 'grouped') {
    const fields: CrudExportColumn[] = [
      ...definition.groupBy.map((field) => ({ field, header: humanizeHeader(field) })),
      ...definition.measures.map((m) => {
        const alias = measureAlias(m)
        return { field: alias, header: humanizeHeader(alias) }
      }),
    ]
    return fields
  }
  if (definition.type === 'summary') {
    return definition.measures.map((m) => {
      const alias = measureAlias(m)
      return { field: alias, header: humanizeHeader(alias) }
    })
  }
  // Pivot already populated meta.fields via executeReport; chart should also have it.
  if (Array.isArray(result.rows) && result.rows.length > 0) {
    const first = result.rows[0] as Record<string, unknown>
    return Object.keys(first).map((field) => ({ field, header: humanizeHeader(field) }))
  }
  return [{ field: 'id', header: 'ID' }]
}

function humanizeHeader(key: string): string {
  const cleaned = key.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) return key
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Run a report and serialize it to one of the formats supported by the shared
 * CRUD exporter (csv / json / xml / markdown). XLSX support lands in Step 3.6b
 * once `exceljs` is added as a dependency.
 */
export async function runReportExport(
  queryEngine: QueryEngine,
  input: ReportExportInput,
  format: CrudExportFormat,
): Promise<ReportExportArtifact> {
  const result = await executeReport(queryEngine, {
    dataset: input.dataset,
    definition: input.definition,
    userFeatures: input.userFeatures,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    params: input.params,
    parameterDefs: input.parameterDefs,
    now: input.now,
    inMemoryCap: input.inMemoryCap,
  })

  const columns = pickExportColumns(input.definition, result)
  const serialized = serializeExport({ columns, rows: result.rows }, format)
  return {
    ...serialized,
    total: result.total,
    cap: result.meta.cap,
    truncated: result.meta.truncated,
  }
}
