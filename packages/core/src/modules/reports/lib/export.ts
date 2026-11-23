import type { Dataset, ParameterDef, ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { ReportColumnDescriptor } from '@open-mercato/shared/modules/reports/dsl'
import {
  defaultExportFilename,
  normalizeExportFormat,
  serializeExport,
  type CrudExportColumn,
  type CrudExportFormat,
} from '@open-mercato/shared/lib/crud/exporters'
import { buildXlsx, XLSX_CONTENT_TYPE, type XlsxCellKind } from './xlsx'
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
  /** Running user id (row-level RBAC pass-through). */
  userId?: string
}

export type ReportExportArtifact = ReportSerializedExport & {
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

export type ReportExportFormat = CrudExportFormat | 'xlsx'

export const REPORT_EXPORT_FORMATS: readonly ReportExportFormat[] = ['csv', 'xlsx', 'json', 'xml', 'markdown']

export function isReportExportFormat(value: unknown): value is ReportExportFormat {
  return typeof value === 'string' && (REPORT_EXPORT_FORMATS as readonly string[]).includes(value)
}

export function normalizeReportExportFormat(raw: unknown): ReportExportFormat | null {
  if (typeof raw === 'string' && ['xlsx', 'excel', 'xls'].includes(raw.trim().toLowerCase())) return 'xlsx'
  return normalizeExportFormat(raw)
}

export function reportExportFilename(base: string | undefined | null, format: ReportExportFormat): string {
  if (format !== 'xlsx') return defaultExportFilename(base, format)
  const safeBase = (base && base.trim().length > 0 ? base.trim() : 'export').replace(/[^a-z0-9_\-]/gi, '_')
  return `${safeBase}.xlsx`
}

function xlsxKind(kind: ReportColumnDescriptor['kind'] | undefined): XlsxCellKind {
  switch (kind) {
    case 'integer':
    case 'float':
    case 'pivot_cell':
      return 'number'
    case 'money':
      return 'money'
    case 'date':
      return 'date'
    case 'datetime':
      return 'datetime'
    case 'boolean':
      return 'boolean'
    default:
      return 'string'
  }
}

/**
 * Exports stay machine-readable: raw typed values (ISO dates, plain
 * decimals) plus, for money columns, a currency column next to the amount
 * so spreadsheets and downstream tools never lose the unit.
 */
function withCurrencyColumns(
  columns: CrudExportColumn[],
  rows: Record<string, unknown>[],
  descriptors: readonly ReportColumnDescriptor[] | undefined,
): { columns: CrudExportColumn[]; rows: Record<string, unknown>[] } {
  if (!descriptors?.length) return { columns, rows }
  const present = new Set(columns.map((c) => c.field))
  const extra: Array<{ after: string; field: string; header: string; value: (row: Record<string, unknown>) => unknown }> = []
  for (const descriptor of descriptors) {
    if (descriptor.kind !== 'money') continue
    if (descriptor.currencyField) {
      if (present.has(descriptor.currencyField)) continue
      const source = descriptor.currencyField
      extra.push({ after: descriptor.key, field: `${descriptor.key}__currency`, header: `${humanizeHeader(descriptor.key)} Currency`, value: (row) => row[source] ?? null })
    } else if (descriptor.currency) {
      const code = descriptor.currency
      extra.push({ after: descriptor.key, field: `${descriptor.key}__currency`, header: `${humanizeHeader(descriptor.key)} Currency`, value: () => code })
    }
  }
  if (!extra.length) return { columns, rows }
  const outColumns: CrudExportColumn[] = []
  for (const column of columns) {
    outColumns.push(column)
    for (const e of extra) if (e.after === column.field) outColumns.push({ field: e.field, header: e.header })
  }
  const outRows = rows.map((row) => {
    const copy: Record<string, unknown> = { ...row }
    for (const e of extra) copy[e.field] = e.value(row)
    return copy
  })
  return { columns: outColumns, rows: outRows }
}

export type ReportSerializedExport = {
  body: string | Buffer
  contentType: string
  fileExtension: string
}

/** Serialize an already-computed result (no re-execution). */
export function serializeReportResult(
  definition: ReportDefinition,
  result: ExecutionResult,
  format: ReportExportFormat,
  options: { sheetName?: string } = {},
): ReportSerializedExport {
  const baseColumns = pickExportColumns(definition, result)
  const { columns, rows } = withCurrencyColumns(baseColumns, result.rows, result.meta.columns)
  if (format === 'xlsx') {
    const byKey = new Map((result.meta.columns ?? []).map((c) => [c.key, c]))
    const body = buildXlsx({
      sheetName: options.sheetName,
      columns: columns.map((column) => {
        const descriptor = byKey.get(column.field)
        return {
          key: column.field,
          header: column.header,
          kind: xlsxKind(descriptor?.kind),
          precision: descriptor?.format?.precision,
        }
      }),
      rows,
    })
    return { body, contentType: XLSX_CONTENT_TYPE, fileExtension: 'xlsx' }
  }
  return serializeExport({ columns, rows }, format)
}

/**
 * Run a report and serialize it to csv / xlsx / json / xml / markdown.
 */
export async function runReportExport(
  queryEngine: QueryEngine,
  input: ReportExportInput,
  format: ReportExportFormat,
): Promise<ReportExportArtifact> {
  const result = await executeReport(queryEngine, {
    dataset: input.dataset,
    definition: input.definition,
    userFeatures: input.userFeatures,
    userId: input.userId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    params: input.params,
    parameterDefs: input.parameterDefs,
    now: input.now,
    inMemoryCap: input.inMemoryCap,
    readAllPages: true,
  })
  const serialized = serializeReportResult(input.definition, result, format)
  return {
    ...serialized,
    total: result.total,
    cap: result.meta.cap,
    truncated: result.meta.truncated,
  }
}
