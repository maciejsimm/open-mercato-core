"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ReportChart } from '../../../widgets/ReportChart'
import type { ChartSpec } from '../../../lib/chart-spec'

/**
 * `record-embed-host` widget — Step 3.11.
 *
 * Renders the configured `reports_embeds` rows that match the host spot
 * + entity id. For each embed, resolves params from the host record
 * (per `paramBindings.record-field`) plus any literal overrides, runs
 * the underlying report or dashboard, and renders the result inline.
 *
 * Field-ACL is enforced server-side (via /api/reports/reports/[id]/run
 * + /api/reports/dashboards/[id]/run); when access is denied the
 * affected card shows a localized "Insufficient access" notice.
 */

type EmbedBinding =
  | { source: 'literal'; value: unknown }
  | { source: 'record-field'; recordField: string }

type EmbedRow = {
  id: string
  hostSpotId: string
  hostEntityId: string
  artifactType: 'report' | 'dashboard'
  artifactId: string
  paramBindings: Record<string, EmbedBinding>
  displayTitle: string | null
  position: number
  enabled: boolean
}

type ReportRunResponse = {
  mode?: string
  rows?: Array<Record<string, unknown>>
  total?: number
  meta?: { fields?: string[] }
  error?: { code?: string; message?: string }
}

type DashboardRunResponse = {
  mode?: string
  tiles?: Array<
    | { tileId: string; reportId: string; mode: string; rows: Record<string, unknown>[]; total: number; meta: Record<string, unknown> }
    | { tileId: string; reportId: string; mode: string; error: { code: string; message: string } }
  >
  error?: { code?: string; message?: string }
}

type HostContext = {
  spotId?: string
  /** Some hosts also pass `data` separately — we read recordId from either. */
  pageContext?: { recordId?: string; entityId?: string }
}

type HostData = Record<string, unknown> | null | undefined

const SPOT_TO_ENTITY: Record<string, string> = {
  'detail:customers.person:after-header': 'customers.person',
  'detail:customers.company:after-header': 'customers.company',
}

function inferSpotId(context: HostContext | undefined, fallback: string): string {
  if (context?.spotId && typeof context.spotId === 'string') return context.spotId
  return fallback
}

function readRecordField(data: HostData, field: string): unknown {
  if (!data || typeof data !== 'object') return undefined
  // Support dotted paths like `person.id` / `company.id`.
  if (!field.includes('.')) {
    return (data as Record<string, unknown>)[field]
  }
  let cur: unknown = data
  for (const part of field.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function inferRecordId(data: HostData, context: HostContext | undefined): string | null {
  const fromContext = context?.pageContext?.recordId
  if (typeof fromContext === 'string' && fromContext.length > 0) return fromContext
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  const direct = obj.id ?? obj.recordId
  if (typeof direct === 'string' && direct.length > 0) return direct
  // Common detail-page wrappers expose nested entities.
  for (const key of ['person', 'company', 'record']) {
    const inner = obj[key]
    if (inner && typeof inner === 'object') {
      const innerId = (inner as Record<string, unknown>).id
      if (typeof innerId === 'string' && innerId.length > 0) return innerId
    }
  }
  return null
}

function resolveParams(
  bindings: Record<string, EmbedBinding> | undefined,
  data: HostData,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!bindings) return out
  for (const [paramKey, binding] of Object.entries(bindings)) {
    if (binding.source === 'literal') {
      out[paramKey] = binding.value
    } else if (binding.source === 'record-field') {
      const value = readRecordField(data, binding.recordField)
      if (value !== undefined) out[paramKey] = value
    }
  }
  return out
}

export type RecordEmbedHostProps = {
  /** The host spot id (e.g. `detail:customers.person:after-header`). */
  spotId?: string
  context?: HostContext
  data?: HostData
}

export default function RecordEmbedHostWidget({ spotId, context, data }: RecordEmbedHostProps) {
  const t = useT()
  const tRef = React.useRef(t)
  React.useEffect(() => { tRef.current = t }, [t])

  const resolvedSpotId = inferSpotId(context, spotId ?? '')
  const hostEntityId = SPOT_TO_ENTITY[resolvedSpotId] ?? context?.pageContext?.entityId ?? ''

  const recordId = inferRecordId(data, context)
  const [embeds, setEmbeds] = React.useState<EmbedRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!hostEntityId || !resolvedSpotId) {
      setEmbeds([])
      setIsLoading(false)
      return
    }
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const params = new URLSearchParams({
          spot: resolvedSpotId,
          hostEntityId,
          enabledOnly: '1',
          pageSize: '20',
        })
        const call = await apiCall<{ items?: EmbedRow[] }>(
          `/api/reports/embeds?${params.toString()}`,
          undefined,
          { fallback: { items: [] } },
        )
        if (cancelled) return
        if (!call.ok) {
          setLoadError(tRef.current('reports.embed.error.load', 'Failed to load embeds.'))
          setEmbeds([])
          return
        }
        const items = Array.isArray(call.result?.items) ? call.result!.items! : []
        setEmbeds(items)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : tRef.current('reports.embed.error.load', 'Failed to load embeds.')
        setLoadError(message)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [hostEntityId, resolvedSpotId])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Spinner className="size-5" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="rounded-md border border-status-error-border bg-status-error-bg px-4 py-3 text-sm text-status-error-text">
        {loadError}
      </div>
    )
  }

  if (embeds.length === 0) return null

  return (
    <section className="space-y-4">
      {embeds.map((embed) => (
        <EmbedCard key={embed.id} embed={embed} hostData={data} recordId={recordId} t={t} />
      ))}
    </section>
  )
}

type EmbedCardProps = {
  embed: EmbedRow
  hostData: HostData
  recordId: string | null
  t: ReturnType<typeof useT>
}

function EmbedCard({ embed, hostData, t }: EmbedCardProps) {
  const params = React.useMemo(() => resolveParams(embed.paramBindings, hostData), [embed.paramBindings, hostData])
  const [result, setResult] = React.useState<ReportRunResponse | DashboardRunResponse | null>(null)
  const [isRunning, setIsRunning] = React.useState(true)
  const [runError, setRunError] = React.useState<string | null>(null)

  const tRef = React.useRef(t)
  React.useEffect(() => { tRef.current = t }, [t])

  React.useEffect(() => {
    let cancelled = false
    async function run() {
      setIsRunning(true)
      setRunError(null)
      const url = embed.artifactType === 'dashboard'
        ? `/api/reports/dashboards/${encodeURIComponent(embed.artifactId)}/run`
        : `/api/reports/reports/${encodeURIComponent(embed.artifactId)}/run`
      try {
        const call = await apiCall<ReportRunResponse | DashboardRunResponse>(
          url,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ params, mode: 'sync' }),
          },
        )
        if (cancelled) return
        if (!call.ok) {
          const code = (call.result as { error?: { code?: string } } | null)?.error?.code
          if (code === 'REPORT_FIELD_ACL_DENIED') {
            setRunError(tRef.current('reports.embed.error.fieldAcl', 'Insufficient access to render this embed.'))
          } else {
            setRunError(tRef.current('reports.embed.error.run', 'Failed to render embed.'))
          }
          return
        }
        setResult(call.result ?? null)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : tRef.current('reports.embed.error.run', 'Failed to render embed.')
        setRunError(message)
      } finally {
        if (!cancelled) setIsRunning(false)
      }
    }
    run()
    return () => { cancelled = true }
    // params is the only meaningful changing key — the embed id stays stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embed.id, JSON.stringify(params)])

  const title = embed.displayTitle ?? t('reports.embed.fallbackTitle', 'Embedded report')

  return (
    <article className="rounded-md border border-border bg-card p-4">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground">
          {embed.artifactType === 'dashboard'
            ? t('reports.embed.artifactTypeDashboard', 'Dashboard')
            : t('reports.embed.artifactTypeReport', 'Report')}
        </span>
      </header>
      {isRunning ? (
        <div className="flex items-center justify-center py-6">
          <Spinner className="size-5" />
        </div>
      ) : runError ? (
        <div className="rounded-md border border-status-warning-border bg-status-warning-bg px-3 py-2 text-sm text-status-warning-text">
          {runError}
        </div>
      ) : (
        renderEmbedBody(embed, result, t)
      )}
    </article>
  )
}

function renderEmbedBody(
  embed: EmbedRow,
  result: ReportRunResponse | DashboardRunResponse | null,
  t: ReturnType<typeof useT>,
): React.ReactNode {
  if (!result) {
    return <p className="text-sm text-muted-foreground">{t('reports.embed.empty', 'No data.')}</p>
  }
  if ((result as ReportRunResponse).rows) {
    const r = result as ReportRunResponse
    if (!r.rows || r.rows.length === 0) {
      return <p className="text-sm text-muted-foreground">{t('reports.embed.empty', 'No data.')}</p>
    }
    return <ResultTable rows={r.rows} fields={r.meta?.fields} />
  }
  const d = result as DashboardRunResponse
  if (!d.tiles || d.tiles.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('reports.embed.empty', 'No data.')}</p>
  }
  return (
    <div className="space-y-3">
      {d.tiles.map((tile, idx) => (
        <DashboardTileCard key={`${embed.id}-${idx}`} tile={tile} t={t} />
      ))}
    </div>
  )
}

type DashboardTileCardProps = {
  tile: NonNullable<DashboardRunResponse['tiles']>[number]
  t: ReturnType<typeof useT>
}

function DashboardTileCard({ tile, t }: DashboardTileCardProps) {
  if ('error' in tile) {
    return (
      <div className="rounded-md border border-status-warning-border bg-status-warning-bg px-3 py-2 text-sm text-status-warning-text">
        {tile.error?.message ?? t('reports.embed.error.run', 'Failed to render embed.')}
      </div>
    )
  }
  if (tile.rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('reports.embed.empty', 'No data.')}</p>
  }
  return <ResultTable rows={tile.rows} fields={Array.isArray((tile.meta as { fields?: unknown }).fields) ? (tile.meta as { fields: string[] }).fields : undefined} />
}

type ResultTableProps = {
  rows: Record<string, unknown>[]
  fields?: string[]
}

function ResultTable({ rows, fields }: ResultTableProps) {
  const columns = fields && fields.length > 0
    ? fields
    : (rows[0] ? Object.keys(rows[0]) : [])
  if (columns.length === 0) return null
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th key={col} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 25).map((row, idx) => (
            <tr key={idx} className="border-b border-border/60 last:border-b-0">
              {columns.map((col) => {
                const value = row[col]
                let display: string
                if (value == null) display = '—'
                else if (typeof value === 'object') display = JSON.stringify(value)
                else display = String(value)
                return <td key={col} className="px-3 py-2 align-top">{display}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Re-export for tests / external consumers.
export type { EmbedRow }
export { resolveParams, inferRecordId, SPOT_TO_ENTITY }
// `ChartSpec` is re-exported so a future polish step can integrate chart rendering directly.
export type { ChartSpec }
