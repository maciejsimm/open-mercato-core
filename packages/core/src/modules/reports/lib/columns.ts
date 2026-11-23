import {
  measureAlias,
  type Dataset,
  type DatasetField,
  type DatasetFieldKind,
  type MeasureExpr,
  type ReportColumnDescriptor,
  type ReportDefinition,
} from '@open-mercato/shared/modules/reports/dsl'

type ScalarKind = Exclude<DatasetFieldKind, 'custom_field'>

/** Resolve the display kind of a dataset field (custom fields map by value kind). */
export function resolveFieldKind(field: DatasetField | undefined): ScalarKind {
  if (!field) return 'text'
  if (field.kind !== 'custom_field') return field.kind
  const valueKind = 'customField' in field ? field.customField.valueKind : 'text'
  switch (valueKind) {
    case 'integer':
      return 'integer'
    case 'float':
      return 'float'
    case 'boolean':
      return 'boolean'
    case 'date':
      return 'date'
    case 'datetime':
      return 'datetime'
    case 'select':
      return 'enum'
    case 'json':
      return 'json'
    default:
      return 'text'
  }
}

function fieldOptions(field: DatasetField | undefined): ReportColumnDescriptor['options'] {
  if (!field || field.kind !== 'enum') return undefined
  return 'options' in field ? field.options : undefined
}

export function describeField(dataset: Dataset, key: string): ReportColumnDescriptor {
  const field = dataset.fields.find((f) => f.key === key)
  const descriptor: ReportColumnDescriptor = {
    key,
    labelKey: field?.labelKey,
    kind: resolveFieldKind(field),
  }
  if (field?.format) descriptor.format = field.format
  if (field?.currency) descriptor.currency = field.currency
  if (field?.currencyField) descriptor.currencyField = field.currencyField
  const options = fieldOptions(field)
  if (options) descriptor.options = options
  return descriptor
}

/**
 * Measures inherit formatting from their source field: `sum`/`min`/`max`/`avg`
 * keep the source kind and currency; `count`/`count_distinct` are integers;
 * `avg` of an integer is a float.
 */
export function describeMeasure(dataset: Dataset, measure: MeasureExpr, key = measureAlias(measure)): ReportColumnDescriptor {
  if (measure.aggregation === 'count' || measure.aggregation === 'count_distinct') {
    return { key, kind: 'integer', sourceField: measure.field, aggregation: measure.aggregation }
  }
  const source = describeField(dataset, measure.field)
  let kind = source.kind
  if (kind !== 'integer' && kind !== 'float' && kind !== 'money' && kind !== 'date' && kind !== 'datetime') {
    kind = 'float'
  }
  if (measure.aggregation === 'avg' && kind === 'integer') kind = 'float'
  if (measure.aggregation === 'avg' && (kind === 'date' || kind === 'datetime')) kind = 'float'
  const descriptor: ReportColumnDescriptor = {
    key,
    kind,
    sourceField: measure.field,
    aggregation: measure.aggregation,
  }
  if (source.format) descriptor.format = source.format
  if (kind === 'money') {
    if (source.currency) descriptor.currency = source.currency
    if (source.currencyField) descriptor.currencyField = source.currencyField
  }
  return descriptor
}

/** Measures declared by an aggregated definition. */
export function definitionMeasures(definition: ReportDefinition): MeasureExpr[] {
  switch (definition.type) {
    case 'grouped':
    case 'summary':
      return definition.measures
    case 'chart':
      return definition.measures ?? []
    case 'pivot':
      return definition.value ? [definition.value] : []
    default:
      return []
  }
}

/**
 * Build one descriptor per output column. Pivot value columns (one per
 * col-key combination) get the value measure's descriptor under their own
 * key. Report-level `columnFormats` are merged over dataset defaults.
 */
export function buildColumnDescriptors(
  definition: ReportDefinition,
  dataset: Dataset,
  outFields: readonly string[],
): ReportColumnDescriptor[] {
  const measuresByAlias = new Map<string, MeasureExpr>()
  for (const m of definitionMeasures(definition)) measuresByAlias.set(measureAlias(m), m)
  const datasetKeys = new Set(dataset.fields.map((f) => f.key))
  const pivotRows = definition.type === 'pivot' ? new Set(definition.rows) : null
  const overrides = definition.columnFormats ?? {}
  return outFields.map((key) => {
    let descriptor: ReportColumnDescriptor
    const measure = measuresByAlias.get(key)
    if (measure) descriptor = describeMeasure(dataset, measure, key)
    else if (pivotRows && !pivotRows.has(key) && definition.type === 'pivot' && definition.value) {
      descriptor = { ...describeMeasure(dataset, definition.value, key) }
    } else if (datasetKeys.has(key)) descriptor = describeField(dataset, key)
    else descriptor = { key, kind: 'text' }
    const override = overrides[key]
    if (override) descriptor = { ...descriptor, format: { ...(descriptor.format ?? {}), ...override } }
    return descriptor
  })
}
