import type { ParameterDef } from '@open-mercato/shared/modules/reports/dsl'

/**
 * Host-spot registry for record-page embeds (spec F17).
 *
 * Lists every widget spot the `reports.injection.record-embed-host` widget is
 * injected into (`widgets/injection-table.ts`), the host entity each spot
 * renders, and the host record fields an embed parameter can be bound to.
 * Field paths are read from the `data` object the host page passes to its
 * `InjectionSpot` (the customers detail overview payload), so dotted paths
 * such as `person.id` are resolved against that shape.
 *
 * `__tests__/embed-spots.test.ts` asserts this list and the injection table
 * stay in sync; add a spot to both when wiring the widget into a new page.
 */

export type EmbedHostFieldKind = 'id' | 'text'

export type EmbedHostField = {
  path: string
  labelKey: string
  label: string
  kind: EmbedHostFieldKind
}

export type EmbedHostSpot = {
  spotId: string
  hostEntityId: string
  labelKey: string
  label: string
  /** List endpoint used to pick a sample record for the configurator preview. */
  sampleListPath: string
  /** Detail endpoint returning the same `data` shape the host page injects. */
  sampleDetailPath: (recordId: string) => string
  /** Path of the record's display name inside the detail payload. */
  displayNamePath: string
  fields: readonly EmbedHostField[]
}

export const EMBED_HOST_WIDGET_ID = 'reports.injection.record-embed-host'

/** Prefix of free-form custom-field paths, accepted in addition to the labelled fields. */
export const EMBED_CUSTOM_FIELD_PREFIX = 'customFields.'

export const EMBED_HOST_SPOTS: readonly EmbedHostSpot[] = [
  {
    spotId: 'detail:customers.person:after-header',
    hostEntityId: 'customers.person',
    labelKey: 'reports.embedSpots.customersPerson',
    label: 'Customer — person',
    sampleListPath: '/api/customers/people?pageSize=10',
    sampleDetailPath: (recordId) => `/api/customers/people/${encodeURIComponent(recordId)}`,
    displayNamePath: 'person.displayName',
    fields: [
      { path: 'person.id', labelKey: 'reports.embedSpots.fields.personId', label: 'Person ID', kind: 'id' },
      { path: 'person.displayName', labelKey: 'reports.embedSpots.fields.displayName', label: 'Display name', kind: 'text' },
      { path: 'person.primaryEmail', labelKey: 'reports.embedSpots.fields.primaryEmail', label: 'Primary email', kind: 'text' },
      { path: 'person.primaryPhone', labelKey: 'reports.embedSpots.fields.primaryPhone', label: 'Primary phone', kind: 'text' },
      { path: 'person.status', labelKey: 'reports.embedSpots.fields.status', label: 'Status', kind: 'text' },
      { path: 'person.lifecycleStage', labelKey: 'reports.embedSpots.fields.lifecycleStage', label: 'Lifecycle stage', kind: 'text' },
      { path: 'person.source', labelKey: 'reports.embedSpots.fields.source', label: 'Source', kind: 'text' },
      { path: 'profile.companyEntityId', labelKey: 'reports.embedSpots.fields.companyId', label: 'Company ID', kind: 'id' },
      { path: 'profile.jobTitle', labelKey: 'reports.embedSpots.fields.jobTitle', label: 'Job title', kind: 'text' },
      { path: 'profile.department', labelKey: 'reports.embedSpots.fields.department', label: 'Department', kind: 'text' },
    ],
  },
  {
    spotId: 'detail:customers.company:after-header',
    hostEntityId: 'customers.company',
    labelKey: 'reports.embedSpots.customersCompany',
    label: 'Customer — company',
    sampleListPath: '/api/customers/companies?pageSize=10',
    sampleDetailPath: (recordId) => `/api/customers/companies/${encodeURIComponent(recordId)}`,
    displayNamePath: 'company.displayName',
    fields: [
      { path: 'company.id', labelKey: 'reports.embedSpots.fields.companyId', label: 'Company ID', kind: 'id' },
      { path: 'company.displayName', labelKey: 'reports.embedSpots.fields.displayName', label: 'Display name', kind: 'text' },
      { path: 'company.ownerUserId', labelKey: 'reports.embedSpots.fields.ownerUserId', label: 'Owner (user ID)', kind: 'id' },
      { path: 'company.primaryEmail', labelKey: 'reports.embedSpots.fields.primaryEmail', label: 'Primary email', kind: 'text' },
      { path: 'company.status', labelKey: 'reports.embedSpots.fields.status', label: 'Status', kind: 'text' },
      { path: 'company.lifecycleStage', labelKey: 'reports.embedSpots.fields.lifecycleStage', label: 'Lifecycle stage', kind: 'text' },
      { path: 'company.source', labelKey: 'reports.embedSpots.fields.source', label: 'Source', kind: 'text' },
      { path: 'profile.industry', labelKey: 'reports.embedSpots.fields.industry', label: 'Industry', kind: 'text' },
      { path: 'profile.domain', labelKey: 'reports.embedSpots.fields.domain', label: 'Domain', kind: 'text' },
      { path: 'profile.sizeBucket', labelKey: 'reports.embedSpots.fields.sizeBucket', label: 'Company size', kind: 'text' },
    ],
  },
]

export function getEmbedHostSpot(spotId: string | null | undefined): EmbedHostSpot | undefined {
  if (!spotId) return undefined
  return EMBED_HOST_SPOTS.find((spot) => spot.spotId === spotId)
}

export function getEmbedHostSpotForEntity(hostEntityId: string | null | undefined): EmbedHostSpot | undefined {
  if (!hostEntityId) return undefined
  return EMBED_HOST_SPOTS.find((spot) => spot.hostEntityId === hostEntityId)
}

export function isKnownEmbedSpot(spotId: string | null | undefined): boolean {
  return getEmbedHostSpot(spotId) !== undefined
}

export function findEmbedHostField(spot: EmbedHostSpot | undefined, path: string): EmbedHostField | undefined {
  return spot?.fields.find((field) => field.path === path)
}

export function isAllowedRecordField(spot: EmbedHostSpot, path: string): boolean {
  if (findEmbedHostField(spot, path)) return true
  return path.startsWith(EMBED_CUSTOM_FIELD_PREFIX) && path.length > EMBED_CUSTOM_FIELD_PREFIX.length
}

/** Read a dotted path from the host record payload. */
export function readHostRecordField(data: unknown, path: string): unknown {
  let cursor: unknown = data
  for (const segment of path.split('.')) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

export type EmbedBinding =
  | { source: 'literal'; value: unknown }
  | { source: 'record-field'; recordField: string }

export type EmbedBindings = Record<string, EmbedBinding>

/** Resolve an embed's parameter bindings against a host record. */
export function resolveEmbedParams(bindings: EmbedBindings | undefined, data: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!bindings) return out
  for (const [paramKey, binding] of Object.entries(bindings)) {
    if (binding.source === 'literal') {
      out[paramKey] = binding.value
    } else {
      const value = readHostRecordField(data, binding.recordField)
      if (value !== undefined && value !== null && value !== '') out[paramKey] = value
    }
  }
  return out
}

export type EmbedConfigIssueCode =
  | 'unknown_spot'
  | 'entity_mismatch'
  | 'undeclared_parameter'
  | 'unknown_record_field'
  | 'empty_literal'
  | 'required_parameter_unbound'

export type EmbedConfigIssue = {
  code: EmbedConfigIssueCode
  /** Field path in the embed payload (`hostSpotId`, `paramBindings.<key>`). */
  path: string
  /** Default English message; the UI translates via `reports.embeds.validation.<code>`. */
  message: string
  param?: string
}

function isEmptyLiteral(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

/**
 * Validate an embed's host spot and parameter bindings against the host-spot
 * registry and the artifact's declared parameters. Shared by the embed
 * commands (server) and the configurator (client) so both reject the same
 * configurations.
 */
export function validateEmbedConfig(input: {
  hostSpotId: string
  hostEntityId?: string | null
  paramBindings?: EmbedBindings
  parameters: readonly ParameterDef[]
}): EmbedConfigIssue[] {
  const issues: EmbedConfigIssue[] = []
  const spot = getEmbedHostSpot(input.hostSpotId)
  if (!spot) {
    issues.push({
      code: 'unknown_spot',
      path: 'hostSpotId',
      message: `Unknown embed spot '${input.hostSpotId}'. Pick one of: ${EMBED_HOST_SPOTS.map((s) => s.spotId).join(', ')}`,
    })
  } else if (input.hostEntityId && input.hostEntityId !== spot.hostEntityId) {
    issues.push({
      code: 'entity_mismatch',
      path: 'hostEntityId',
      message: `Spot '${spot.spotId}' renders '${spot.hostEntityId}', not '${input.hostEntityId}'`,
    })
  }
  const declared = new Map(input.parameters.map((param) => [param.key, param]))
  const bindings = input.paramBindings ?? {}
  for (const [paramKey, binding] of Object.entries(bindings)) {
    const path = `paramBindings.${paramKey}`
    if (!declared.has(paramKey)) {
      issues.push({ code: 'undeclared_parameter', path, param: paramKey, message: `Parameter '${paramKey}' is not declared by the artifact` })
      continue
    }
    if (binding.source === 'record-field') {
      if (spot && !isAllowedRecordField(spot, binding.recordField)) {
        issues.push({
          code: 'unknown_record_field',
          path,
          param: paramKey,
          message: `Record field '${binding.recordField}' is not available on '${spot.hostEntityId}'`,
        })
      }
    } else if (isEmptyLiteral(binding.value)) {
      issues.push({ code: 'empty_literal', path, param: paramKey, message: `Fixed value for '${paramKey}' is empty` })
    }
  }
  for (const param of input.parameters) {
    if (!param.required) continue
    if (bindings[param.key]) continue
    if (param.defaultValue !== undefined && param.defaultValue !== null && param.defaultValue !== '') continue
    issues.push({
      code: 'required_parameter_unbound',
      path: `paramBindings.${param.key}`,
      param: param.key,
      message: `Required parameter '${param.key}' has no binding`,
    })
  }
  return issues
}

/** Narrow an artifact's stored `parameters_json` into `ParameterDef[]`. */
export function readParameterDefs(raw: unknown): ParameterDef[] {
  if (!Array.isArray(raw)) return []
  const out: ParameterDef[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Partial<ParameterDef>
    if (typeof candidate.key !== 'string' || typeof candidate.kind !== 'string') continue
    out.push(candidate as ParameterDef)
  }
  return out
}

export type EmbedBindingDraft =
  | { source: 'none' }
  | { source: 'record-field'; recordField: string }
  | { source: 'literal'; value: unknown }

/** Convert configurator rows into stored bindings; unbound rows are omitted. */
export function draftsToBindings(drafts: Readonly<Record<string, EmbedBindingDraft>>): EmbedBindings {
  const out: EmbedBindings = {}
  for (const [paramKey, draft] of Object.entries(drafts)) {
    if (draft.source === 'record-field') {
      if (draft.recordField) out[paramKey] = { source: 'record-field', recordField: draft.recordField }
    } else if (draft.source === 'literal') {
      out[paramKey] = { source: 'literal', value: draft.value }
    }
  }
  return out
}

/**
 * Default row for a parameter: an existing binding wins; otherwise an `fk`
 * parameter whose key names a host field (`companyId` → `Company ID`) or the
 * host record's own id is pre-bound to that field.
 */
export function suggestBindingDraft(
  spot: EmbedHostSpot | undefined,
  param: ParameterDef,
  existing?: EmbedBinding,
): EmbedBindingDraft {
  if (existing?.source === 'record-field') return { source: 'record-field', recordField: existing.recordField }
  if (existing?.source === 'literal') return { source: 'literal', value: existing.value }
  if (!spot || param.kind !== 'fk') return { source: 'none' }
  const normalizedKey = param.key.toLowerCase().replace(/[^a-z]/g, '')
  const byName = spot.fields.find((field) => {
    const tail = field.path.split('.').pop() ?? ''
    const normalizedTail = tail.toLowerCase().replace(/[^a-z]/g, '')
    const normalizedPath = field.path.toLowerCase().replace(/[^a-z]/g, '')
    return field.kind === 'id' && (normalizedTail === normalizedKey || normalizedPath === normalizedKey)
  })
  const fallback = spot.fields.find((field) => field.kind === 'id')
  const match = byName ?? fallback
  return match ? { source: 'record-field', recordField: match.path } : { source: 'none' }
}
