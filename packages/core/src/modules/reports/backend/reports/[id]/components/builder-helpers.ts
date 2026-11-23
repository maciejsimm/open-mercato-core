import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { measureAlias, type Sort } from '@open-mercato/shared/modules/reports/dsl'
import type {
  BuilderDefinition,
  BuilderFilter,
  DroppedItem,
} from '../../../../lib/definition-migrate'
import { measureLabel, type ResultField } from './ResultView'

export type BuilderField = ResultField & { sortable?: boolean }

export type BuilderParameter = {
  key: string
  labelKey?: string
  kind: string
  defaultValue?: unknown
  required?: boolean
  relatedDatasetId?: string
  options?: Array<string | number>
}

/** Parameter keys referenced by `kind: 'parameter'` filters. */
export function referencedParameterKeys(filters: readonly BuilderFilter[]): Set<string> {
  const out = new Set<string>()
  for (const filter of filters) {
    if (filter.kind === 'parameter' && filter.parameter) out.add(filter.parameter)
  }
  return out
}

/**
 * The parameter declarations that can change a preview result: only those a
 * filter references, reduced to the fields the executor reads. Labels and
 * unreferenced declarations (e.g. a key still being typed) are left out so
 * editing them never re-runs the preview.
 */
export function previewParameters(
  filters: readonly BuilderFilter[],
  parameters: readonly BuilderParameter[],
): BuilderParameter[] {
  const referenced = referencedParameterKeys(filters)
  if (referenced.size === 0) return []
  return parameters
    .filter((param) => referenced.has(param.key))
    .map((param) => {
      const out: BuilderParameter = { key: param.key, kind: param.kind }
      if (param.defaultValue !== undefined) out.defaultValue = param.defaultValue
      if (param.required !== undefined) out.required = param.required
      if (param.relatedDatasetId !== undefined) out.relatedDatasetId = param.relatedDatasetId
      if (param.options !== undefined) out.options = param.options
      return out
    })
}

/** Stable request body for the live preview; equal strings mean equal results. */
export function buildPreviewRequestBody(
  datasetId: string,
  definition: BuilderDefinition,
  parameters: readonly BuilderParameter[],
  limit = 10,
): string {
  return JSON.stringify({
    datasetId,
    definition,
    parameters: previewParameters(definition.filters, parameters),
    limit,
  })
}

/** Case-insensitive match of a dataset field on its translated label or its key. */
export function filterFieldsByQuery<T extends { key: string; labelKey: string }>(
  fields: readonly T[],
  query: string,
  translate: (key: string, fallback: string) => string,
): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...fields]
  return fields.filter((field) => {
    if (field.key.toLowerCase().includes(needle)) return true
    return translate(field.labelKey, field.key).toLowerCase().includes(needle)
  })
}

export type SortCandidate = {
  key: string
  label: string
  /** Translated enum option labels in declared order (the natural ascending order). */
  enumOrder?: string[]
  /** True when the key comes from a measure alias rather than a dataset field. */
  isMeasure?: boolean
}

/** Report types whose definition schema carries a `sort` list. */
export function supportsSort(definition: BuilderDefinition): definition is Extract<BuilderDefinition, { sort: Sort[] }> {
  return definition.type === 'flat_list' || definition.type === 'grouped'
}

/** Report types whose definition schema carries a `limit`. */
export function supportsLimit(definition: BuilderDefinition): boolean {
  return definition.type === 'flat_list' || definition.type === 'grouped' || definition.type === 'chart'
}

function enumOrderFor(field: BuilderField | undefined, translate: TranslateFn): string[] | undefined {
  if (!field || field.kind !== 'enum' || !Array.isArray(field.options) || field.options.length === 0) return undefined
  return field.options.map((option) => {
    if (typeof option === 'object' && option !== null) {
      const raw = String(option.value)
      return option.labelKey ? translate(option.labelKey, raw) : raw
    }
    return String(option)
  })
}

/**
 * Keys a report can sort by. Flat lists sort by any sortable dataset field;
 * grouped reports sort their aggregated rows, so only group keys and measure
 * aliases exist there. Enum group keys carry their declared option order.
 */
export function sortCandidates(
  definition: BuilderDefinition,
  fields: readonly BuilderField[],
  fieldByKey: ReadonlyMap<string, BuilderField>,
  translate: TranslateFn,
): SortCandidate[] {
  if (definition.type === 'flat_list') {
    return fields
      .filter((field) => field.sortable !== false)
      .map((field) => ({ key: field.key, label: translate(field.labelKey, field.key) }))
  }
  if (definition.type === 'grouped') {
    const out: SortCandidate[] = []
    const seen = new Set<string>()
    for (const key of definition.groupBy) {
      if (seen.has(key)) continue
      seen.add(key)
      const field = fieldByKey.get(key)
      out.push({
        key,
        label: field ? translate(field.labelKey, field.key) : key,
        enumOrder: enumOrderFor(field, translate),
      })
    }
    for (const measure of definition.measures) {
      const alias = measureAlias(measure)
      if (seen.has(alias)) continue
      seen.add(alias)
      out.push({ key: alias, label: measureLabel(measure, fieldByKey, translate), isMeasure: true })
    }
    return out
  }
  return []
}

/** Move a sort entry one step up (-1) or down (+1); no-op at the edges. */
export function moveSortEntry(sort: readonly Sort[], index: number, delta: -1 | 1): Sort[] {
  const target = index + delta
  if (index < 0 || index >= sort.length || target < 0 || target >= sort.length) return [...sort]
  const next = [...sort]
  const [entry] = next.splice(index, 1)
  next.splice(target, 0, entry)
  return next
}

/** First candidate not already used by another sort entry. */
export function nextSortCandidate(sort: readonly Sort[], candidates: readonly SortCandidate[]): SortCandidate | undefined {
  const used = new Set(sort.map((entry) => entry.field))
  return candidates.find((candidate) => !used.has(candidate.key))
}

const DROPPED_SLOT_ORDER: ReadonlyArray<DroppedItem['slot']> = ['fields', 'groupBy', 'cols', 'measures', 'sort', 'limit', 'chart']

const DROPPED_SLOT_LABELS: Record<DroppedItem['slot'], { key: string; fallback: string }> = {
  fields: { key: 'reports.detail.typeSwitch.slots.fields', fallback: 'Fields' },
  groupBy: { key: 'reports.detail.typeSwitch.slots.groupBy', fallback: 'Group by' },
  cols: { key: 'reports.detail.typeSwitch.slots.cols', fallback: 'Pivot columns' },
  measures: { key: 'reports.detail.typeSwitch.slots.measures', fallback: 'Measures' },
  sort: { key: 'reports.detail.typeSwitch.slots.sort', fallback: 'Sort' },
  limit: { key: 'reports.detail.typeSwitch.slots.limit', fallback: 'Limit' },
  chart: { key: 'reports.detail.typeSwitch.slots.chart', fallback: 'Chart settings' },
}

function droppedItemLabel(item: DroppedItem, fieldByKey: ReadonlyMap<string, BuilderField>, translate: TranslateFn): string {
  switch (item.slot) {
    case 'measures':
      return measureLabel({ field: item.field, aggregation: item.aggregation }, fieldByKey, translate)
    case 'limit':
      return String(item.value)
    case 'chart':
      return translate(`reports.detail.chart.kind.${item.chartType}`, item.chartType)
    default: {
      const field = fieldByKey.get(item.field)
      return field ? translate(field.labelKey, field.key) : item.field
    }
  }
}

/**
 * One-line flash message for a type switch that could not carry everything
 * over, e.g. `Chart cannot keep everything. Not carried over — Fields: Name;
 * Sort: Created. Switch back without editing to restore the previous setup.`
 */
export function buildTypeSwitchMessage(
  type: string,
  dropped: readonly DroppedItem[],
  fieldByKey: ReadonlyMap<string, BuilderField>,
  translate: TranslateFn,
): string {
  const groups = DROPPED_SLOT_ORDER
    .map((slot) => ({ slot, items: dropped.filter((item) => item.slot === slot) }))
    .filter((group) => group.items.length > 0)
    .map((group) => {
      const label = translate(DROPPED_SLOT_LABELS[group.slot].key, DROPPED_SLOT_LABELS[group.slot].fallback)
      const values = group.items.map((item) => droppedItemLabel(item, fieldByKey, translate)).join(', ')
      return `${label}: ${values}`
    })
  const head = translate('reports.detail.typeSwitch.dropped', '{type} cannot keep everything. Not carried over:', {
    type: translate(`reports.list.types.${type}`, type),
  })
  const hint = translate('reports.detail.typeSwitch.restoreHint', 'Switch back without editing to restore the previous setup.')
  return `${head} ${groups.join('; ')}. ${hint}`
}
