import type { EntityId } from '@open-mercato/shared/modules/entities'

// ---------- Field kinds ----------

export type DatasetFieldKind =
  | 'id'
  | 'text'
  | 'integer'
  | 'float'
  | 'money'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'fk'
  | 'custom_field'
  | 'json'

export type Aggregation =
  | 'count'
  | 'count_distinct'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'

export type DateRangeToken =
  | 'today'
  | 'yesterday'
  | 'last_24h'
  | 'last_7_days'
  | 'last_30_days'
  | 'mtd'
  | 'last_month'
  | 'qtd'
  | 'last_quarter'
  | 'ytd'
  | 'last_year'
  | 'custom'

export type ParameterDef = {
  key: string
  labelKey?: string
  kind: 'string' | 'number' | 'boolean' | 'date' | 'date_range' | 'fk' | 'enum'
  defaultValue?: unknown
  required?: boolean
  /** For `fk` parameters: the related dataset id (e.g. `customers.people`). */
  relatedDatasetId?: string
  /** For `enum` parameters: allowed values. */
  options?: Array<string | number | { value: string | number; labelKey?: string }>
}

// ---------- Filter / sort / measure expressions ----------

export type FilterOp =
  | 'eq'
  | 'ne'
  | 'in'
  | 'nin'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_null'
  | 'is_not_null'
  | 'between'

export type FilterExpr =
  | { kind: 'literal'; field: string; op: FilterOp; value: unknown }
  | { kind: 'parameter'; field: string; op: FilterOp; parameter: string }
  | { kind: 'date_range'; field: string; token: DateRangeToken; from?: string; to?: string }
  | { kind: 'group'; op: 'and' | 'or'; children: FilterExpr[] }

export type Sort = { field: string; dir: 'asc' | 'desc' }

export type MeasureExpr = {
  field: string
  aggregation: Aggregation
  alias?: string
}

// ---------- Dataset fields ----------

export type DatasetFieldBase = {
  key: string
  labelKey: string
  kind: DatasetFieldKind
  description?: string
  /** Aggregations the executor is allowed to apply. Omitted = no aggregation supported. */
  aggregations?: Aggregation[]
  /** Whether this field is filterable. Defaults to true for non-`json` fields. */
  filterable?: boolean
  /** Whether the field is sortable. Defaults to filterable. */
  sortable?: boolean
}

export type DatasetEnumField = DatasetFieldBase & {
  kind: 'enum'
  /** Dictionary id (e.g. `sales.order_status`) used to render labels and option lists. */
  dictionary?: string
  /** Static enum options, when not backed by a dictionary. */
  options?: Array<string | number | { value: string | number; labelKey?: string }>
}

export type DatasetFkField = DatasetFieldBase & {
  kind: 'fk'
  /** The dataset id to join to via `joins[].id`. */
  joinTo: string
}

export type DatasetCustomField = DatasetFieldBase & {
  kind: 'custom_field'
  customField: {
    entityId: EntityId
    key: string
    valueKind: 'text' | 'integer' | 'float' | 'boolean' | 'select' | 'date' | 'datetime' | 'json'
  }
}

export type DatasetField =
  | DatasetFieldBase
  | DatasetEnumField
  | DatasetFkField
  | DatasetCustomField

// ---------- Joins ----------

export type DatasetJoin = {
  id: string
  /** Dataset id this join points to (e.g. `customers.people`). */
  dataset: string
  on: { local: string; remote: string }
  cardinality: 'one-to-one' | 'many-to-one' | 'one-to-many' | 'many-to-many'
  description?: string
}

// ---------- Field-ACL map ----------

/**
 * Maps field paths (`field` or `join.field`) to required ACL features.
 * A user must have **at least one** of the listed features for the field
 * to be visible / filterable / aggregatable.
 */
export type DatasetFieldAclMap = Record<string, string[]>

// ---------- Dataset ----------

export type Dataset = {
  id: string
  moduleId: string
  labelKey: string
  descriptionKey?: string
  entityType: EntityId
  /** Features required to even discover this dataset. */
  requiredFeatures?: string[]
  fields: DatasetField[]
  joins?: DatasetJoin[]
  fieldAcl?: DatasetFieldAclMap
  defaultSort?: Sort[]
  /** Optional, defaults to 100. Hard cap is enforced by the platform (`pageSize <= 100`). */
  defaultPageSize?: number
  /** Optional list of parameter declarations baked into the dataset. */
  parameters?: ParameterDef[]
}

/**
 * Declare a dataset for the reports module.
 *
 * Datasets are auto-discovered from each module's `reports.ts` file via the
 * platform generator (see `packages/cli/src/lib/generators/module-registry.ts`).
 * Field-level ACL is enforced at three points (builder load, save, run);
 * see `packages/core/src/modules/reports/lib/field-redact.ts`.
 */
export function defineDataset(spec: Dataset): Dataset {
  if (!spec.id || !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(spec.id)) {
    throw new Error(`defineDataset: id must match '<module>.<entity>' (got '${spec.id}')`)
  }
  if (!spec.moduleId) throw new Error(`defineDataset(${spec.id}): moduleId is required`)
  if (!spec.entityType) throw new Error(`defineDataset(${spec.id}): entityType is required`)
  if (!spec.fields?.length) throw new Error(`defineDataset(${spec.id}): at least one field is required`)
  return spec
}

/** Convenience helper to declare a measure expression. */
export function defineMeasure(field: string, aggregation: Aggregation, alias?: string): MeasureExpr {
  return { field, aggregation, alias }
}

// ---------- Report definition shape (shared between server + UI) ----------

export type ChartKind = 'bar' | 'line' | 'pie' | 'area' | 'donut' | 'scatter' | 'combo'

export type ChartSpec = {
  type: ChartKind
  /** Field on the X axis. Must be a categorical dataset field (or a declared groupBy key). */
  xField: string
  /** Measure aliases plotted as Y series. Must be produced by `measures[]` when declared. */
  yFields: string[]
  stacked?: boolean
  showLegend?: boolean
  /** Reserved for richer styling later (axis labels, palette overrides). */
  xAxisLabel?: string
  yAxisLabel?: string
  palette?: string[]
}

export type ReportDefinition =
  | {
      type: 'flat_list'
      fields: string[]
      filters: FilterExpr[]
      sort: Sort[]
      limit?: number
    }
  | {
      type: 'grouped'
      fields: string[]
      groupBy: string[]
      measures: MeasureExpr[]
      filters: FilterExpr[]
      sort: Sort[]
      limit?: number
    }
  | {
      type: 'pivot'
      rows: string[]
      cols: string[]
      value: MeasureExpr
      filters: FilterExpr[]
    }
  | {
      type: 'chart'
      chart: ChartSpec
      filters: FilterExpr[]
      groupBy?: string[]
      measures?: MeasureExpr[]
      limit?: number
    }
  | {
      type: 'summary'
      measures: MeasureExpr[]
      filters: FilterExpr[]
    }

export type ReportType = ReportDefinition['type']
