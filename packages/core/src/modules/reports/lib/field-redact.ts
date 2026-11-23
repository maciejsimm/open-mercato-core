import { hasAnyReportFeature } from './feature-access'
import type {
  Dataset,
  DatasetField,
  DatasetFieldAclMap,
  FilterExpr,
  MeasureExpr,
  ReportDefinition,
  Sort,
} from '@open-mercato/shared/modules/reports/dsl'

export type FieldAclDecision = {
  field: string
  allowed: boolean
  missingFeatures: string[]
}

export type RedactedDataset = Dataset & {
  /** The subset of `fields` the user is allowed to see. */
  visibleFields: DatasetField[]
  /** Field paths the user cannot see, by path string. */
  hiddenFieldPaths: string[]
}

export class FieldAclDeniedError extends Error {
  code = 'REPORT_FIELD_ACL_DENIED' as const
  fields: string[]
  constructor(fields: string[]) {
    super(`Field-level ACL denied for: ${fields.join(', ')}`)
    this.fields = fields
  }
}

/** Decide if a single field path is visible to a user with `userFeatures`. */
export function isFieldVisible(
  fieldPath: string,
  acl: DatasetFieldAclMap | undefined,
  userFeatures: ReadonlySet<string>,
): FieldAclDecision {
  const required = acl?.[fieldPath]
  if (!required?.length) return { field: fieldPath, allowed: true, missingFeatures: [] }
  const hasAny = hasAnyReportFeature(userFeatures, required)
  return {
    field: fieldPath,
    allowed: hasAny,
    missingFeatures: hasAny ? [] : [...required],
  }
}


/**
 * Step 1: builder-load enforcement.
 * Returns a copy of the dataset with hidden fields stripped.
 */
export function redactDatasetFields(
  dataset: Dataset,
  userFeatures: ReadonlySet<string>,
): RedactedDataset {
  const visibleFields: DatasetField[] = []
  const hiddenFieldPaths: string[] = []
  for (const field of dataset.fields) {
    const decision = isFieldVisible(field.key, dataset.fieldAcl, userFeatures)
    if (decision.allowed) {
      visibleFields.push(field)
    } else {
      hiddenFieldPaths.push(field.key)
    }
  }
  return {
    ...dataset,
    fields: visibleFields,
    visibleFields,
    hiddenFieldPaths,
  }
}

function collectFilterFieldRefs(filter: FilterExpr, into: Set<string>): void {
  if (filter.kind === 'group') {
    for (const child of filter.children) collectFilterFieldRefs(child, into)
    return
  }
  into.add(filter.field)
}

function collectMeasureFieldRefs(measures: MeasureExpr[] | undefined, into: Set<string>): void {
  if (!measures) return
  for (const m of measures) into.add(m.field)
}

function collectSortFieldRefs(sort: Sort[] | undefined, into: Set<string>): void {
  if (!sort) return
  for (const s of sort) into.add(s.field)
}

/**
 * Collect every field path referenced by a report definition. Used by
 * step-2 (save) and step-3 (run) enforcement to prove the definition does
 * not touch any field the running user cannot see.
 */
export function collectReferencedFieldPaths(def: ReportDefinition): string[] {
  const out = new Set<string>()
  for (const f of def.filters) collectFilterFieldRefs(f, out)
  switch (def.type) {
    case 'flat_list':
      for (const f of def.fields) out.add(f)
      collectSortFieldRefs(def.sort, out)
      break
    case 'grouped':
      for (const f of def.fields) out.add(f)
      for (const g of def.groupBy) out.add(g)
      collectMeasureFieldRefs(def.measures, out)
      collectSortFieldRefs(def.sort, out)
      break
    case 'pivot':
      for (const r of def.rows) out.add(r)
      for (const c of def.cols) out.add(c)
      out.add(def.value.field)
      break
    case 'chart':
      if (def.chart?.xField) out.add(def.chart.xField)
      if (def.groupBy) for (const g of def.groupBy) out.add(g)
      collectMeasureFieldRefs(def.measures, out)
      // yFields are measure aliases (not dataset fields) — the underlying
      // dataset fields are already pulled in via def.measures above.
      break
    case 'summary':
      collectMeasureFieldRefs(def.measures, out)
      break
  }
  return [...out]
}

/**
 * Steps 2 + 3: save + run enforcement.
 * Throws `FieldAclDeniedError` if the definition references any field the
 * user cannot see in the redacted dataset. This is the only point at which
 * aggregations (group-by / pivot / measures) are checked against ACL.
 */
export function validateDefinitionAgainstAcl(
  definition: ReportDefinition,
  dataset: Dataset,
  userFeatures: ReadonlySet<string>,
): void {
  const referenced = collectReferencedFieldPaths(definition)
  const denied: string[] = []
  for (const path of referenced) {
    const decision = isFieldVisible(path, dataset.fieldAcl, userFeatures)
    if (!decision.allowed) denied.push(path)
  }
  if (denied.length) throw new FieldAclDeniedError(denied)
}

/**
 * Convenience helper that wraps `validateDefinitionAgainstAcl` and returns
 * the redacted dataset for downstream consumers (e.g. the API layer that
 * needs both the validated definition and the user-visible field set).
 */
export function redactAndValidate(
  definition: ReportDefinition,
  dataset: Dataset,
  userFeatures: ReadonlySet<string>,
): RedactedDataset {
  validateDefinitionAgainstAcl(definition, dataset, userFeatures)
  return redactDatasetFields(dataset, userFeatures)
}
