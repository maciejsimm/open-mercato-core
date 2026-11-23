import type { EmbedBindings } from '../../../lib/embed-spots'

export type ReportWidgetArtifactType = 'report' | 'dashboard'

export type ReportWidgetSettings = {
  artifactType: ReportWidgetArtifactType
  artifactId: string | null
  /** Fixed parameter values keyed by parameter key. */
  params: Record<string, unknown>
  /** Optional heading; the artifact name is shown when empty. */
  title: string
}

export const DEFAULT_SETTINGS: ReportWidgetSettings = {
  artifactType: 'report',
  artifactId: null,
  params: {},
  title: '',
}

const MAX_TITLE_LENGTH = 200

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

export function hydrateReportWidgetSettings(raw: unknown): ReportWidgetSettings {
  if (!isPlainObject(raw)) return { ...DEFAULT_SETTINGS, params: {} }
  const artifactType: ReportWidgetArtifactType = raw.artifactType === 'dashboard' ? 'dashboard' : 'report'
  const artifactId = typeof raw.artifactId === 'string' && raw.artifactId.trim().length > 0 ? raw.artifactId.trim() : null
  const params: Record<string, unknown> = {}
  if (isPlainObject(raw.params)) {
    for (const [key, value] of Object.entries(raw.params)) {
      if (!isEmptyValue(value)) params[key] = value
    }
  }
  const title = typeof raw.title === 'string' ? raw.title.slice(0, MAX_TITLE_LENGTH) : ''
  return { artifactType, artifactId, params, title }
}

export function dehydrateReportWidgetSettings(settings: ReportWidgetSettings): ReportWidgetSettings {
  return hydrateReportWidgetSettings(settings)
}

/** Fixed parameter values as literal embed bindings, so the widget renders through `EmbedCard`. */
export function settingsToBindings(settings: ReportWidgetSettings): EmbedBindings {
  const out: EmbedBindings = {}
  for (const [key, value] of Object.entries(settings.params)) {
    if (!isEmptyValue(value)) out[key] = { source: 'literal', value }
  }
  return out
}
