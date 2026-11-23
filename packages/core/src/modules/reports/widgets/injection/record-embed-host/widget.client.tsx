"use client"

import * as React from 'react'
import Link from 'next/link'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import type { ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import type { ChartSpec } from '../../../lib/chart-spec'
import {
  EMBED_HOST_SPOTS,
  getEmbedHostSpot,
  getEmbedHostSpotForEntity,
  readHostRecordField,
  resolveEmbedParams,
  type EmbedBinding,
  type EmbedBindings,
} from '../../../lib/embed-spots'
import { ReportResultView, readRunMeta } from './ReportResultView'

/**
 * `record-embed-host` widget — Step 3.11 / F17.
 *
 * Renders the configured `reports_embeds` rows for the host spot. The spot is
 * resolved from the host-spot registry (`lib/embed-spots.ts`): `InjectionSpot`
 * does not pass its spot id to widgets, so the widget matches the host page's
 * `context.resourceKind` (e.g. `customers.person`) to a registered spot.
 * Parameters come from the embed's bindings (record field or fixed value);
 * values render through `formatReportValue`.
 *
 * Field-ACL is enforced server-side by the run routes; an ACL denial shows a
 * localized "Insufficient access" notice on the affected card.
 */

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
  meta?: unknown
  error?: { code?: string; message?: string }
}

type DashboardTileResult =
  | { tileId: string; reportId: string; mode: string; rows: Record<string, unknown>[]; total: number; meta: unknown }
  | { tileId: string; reportId: string; mode: string; error: { code: string; message: string } }

type DashboardRunResponse = {
  mode?: string
  tiles?: DashboardTileResult[]
  error?: { code?: string; message?: string }
}

type HostContext = {
  spotId?: string
  resourceKind?: string
  pageContext?: { recordId?: string; entityId?: string }
}

type HostData = Record<string, unknown> | null | undefined

/** @deprecated Use the host-spot registry in `lib/embed-spots.ts`. */
const SPOT_TO_ENTITY: Record<string, string> = Object.fromEntries(
  EMBED_HOST_SPOTS.map((spot) => [spot.spotId, spot.hostEntityId]),
)

export function resolveHostSpotId(spotId: string | undefined, context: HostContext | undefined): string | null {
  if (spotId && getEmbedHostSpot(spotId)) return spotId
  if (context?.spotId && getEmbedHostSpot(context.spotId)) return context.spotId
  const entity = context?.resourceKind ?? context?.pageContext?.entityId
  return getEmbedHostSpotForEntity(entity)?.spotId ?? null
}

function inferRecordId(data: HostData, context: HostContext | undefined): string | null {
  const fromContext = context?.pageContext?.recordId
  if (typeof fromContext === 'string' && fromContext.length > 0) return fromContext
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  const direct = obj.id ?? obj.recordId
  if (typeof direct === 'string' && direct.length > 0) return direct
  for (const key of ['person', 'company', 'record']) {
    const innerId = readHostRecordField(obj, `${key}.id`)
    if (typeof innerId === 'string' && innerId.length > 0) return innerId
  }
  return null
}

/** @deprecated Use `resolveEmbedParams` from `lib/embed-spots.ts`. */
function resolveParams(bindings: EmbedBindings | undefined, data: HostData): Record<string, unknown> {
  return resolveEmbedParams(bindings, data)
}

export type RecordEmbedHostProps = {
  spotId?: string
  context?: HostContext
  data?: HostData
}

export default function RecordEmbedHostWidget({ spotId, context, data }: RecordEmbedHostProps) {
  const t = useT()
  const tRef = React.useRef(t)
  React.useEffect(() => { tRef.current = t }, [t])

  const resolvedSpotId = resolveHostSpotId(spotId, context)
  const hostEntityId = getEmbedHostSpot(resolvedSpotId)?.hostEntityId ?? ''

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
          spot: resolvedSpotId ?? '',
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
        setEmbeds(Array.isArray(call.result?.items) ? call.result!.items! : [])
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : tRef.current('reports.embed.error.load', 'Failed to load embeds.'))
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
        <EmbedCard
          key={embed.id}
          artifactType={embed.artifactType}
          artifactId={embed.artifactId}
          paramBindings={embed.paramBindings}
          displayTitle={embed.displayTitle}
          hostData={data}
        />
      ))}
    </section>
  )
}

export type EmbedCardProps = {
  artifactType: 'report' | 'dashboard'
  artifactId: string
  paramBindings: EmbedBindings
  displayTitle: string | null
  hostData: unknown
}

/** One embed rendered against a host record. Also used by the configurator preview. */
export function EmbedCard({ artifactType, artifactId, paramBindings, displayTitle, hostData }: EmbedCardProps) {
  const t = useT()
  const tRef = React.useRef(t)
  React.useEffect(() => { tRef.current = t }, [t])

  const params = React.useMemo(() => resolveEmbedParams(paramBindings, hostData), [paramBindings, hostData])
  const paramsKey = JSON.stringify(params)
  const [result, setResult] = React.useState<ReportRunResponse | DashboardRunResponse | null>(null)
  const [definition, setDefinition] = React.useState<ReportDefinition | null>(null)
  const [artifactName, setArtifactName] = React.useState<string | null>(null)
  const [isRunning, setIsRunning] = React.useState(true)
  const [runError, setRunError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function loadArtifact() {
      const listUrl = artifactType === 'dashboard' ? '/api/reports/dashboards' : '/api/reports/reports'
      const call = await apiCall<{ items?: Array<{ name?: string; definition?: ReportDefinition | null }> }>(
        `${listUrl}?id=${encodeURIComponent(artifactId)}&pageSize=1`,
        undefined,
        { fallback: { items: [] } },
      )
      if (cancelled || !call.ok) return
      const item = Array.isArray(call.result?.items) ? call.result!.items![0] : undefined
      setArtifactName(item?.name ?? null)
      setDefinition(item?.definition ?? null)
    }
    loadArtifact().catch(() => undefined)
    return () => { cancelled = true }
  }, [artifactId, artifactType])

  React.useEffect(() => {
    let cancelled = false
    async function run() {
      setIsRunning(true)
      setRunError(null)
      const url = artifactType === 'dashboard'
        ? `/api/reports/dashboards/${encodeURIComponent(artifactId)}/run`
        : `/api/reports/reports/${encodeURIComponent(artifactId)}/run`
      try {
        const call = await apiCall<ReportRunResponse | DashboardRunResponse>(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ params: JSON.parse(paramsKey) as Record<string, unknown>, mode: 'sync' }),
        })
        if (cancelled) return
        if (!call.ok) {
          const code = (call.result as { error?: { code?: string } } | null)?.error?.code
          setRunError(code === 'REPORT_FIELD_ACL_DENIED'
            ? tRef.current('reports.embed.error.fieldAcl', 'Insufficient access to render this embed.')
            : tRef.current('reports.embed.error.run', 'Failed to render embed.'))
          return
        }
        setResult(call.result ?? null)
      } catch (err) {
        if (cancelled) return
        setRunError(err instanceof Error ? err.message : tRef.current('reports.embed.error.run', 'Failed to render embed.'))
      } finally {
        if (!cancelled) setIsRunning(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [artifactId, artifactType, paramsKey])

  const title = displayTitle || artifactName || t('reports.embed.fallbackTitle', 'Embedded report')
  const openHref = artifactType === 'dashboard'
    ? `/backend/reports/dashboards/${encodeURIComponent(artifactId)}`
    : `/backend/reports/${encodeURIComponent(artifactId)}`

  return (
    <article className="rounded-md border border-border bg-card p-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <Link href={openHref} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          {artifactType === 'dashboard'
            ? t('reports.embed.openDashboard', 'Open dashboard')
            : t('reports.embed.openReport', 'Open report')}
        </Link>
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
        <EmbedBody result={result} definition={definition} />
      )}
    </article>
  )
}

function EmbedBody({ result, definition }: { result: ReportRunResponse | DashboardRunResponse | null; definition: ReportDefinition | null }) {
  const t = useT()
  if (!result) {
    return <p className="text-sm text-muted-foreground">{t('reports.embed.empty', 'No data.')}</p>
  }
  if ('rows' in result && Array.isArray(result.rows)) {
    return <ReportResultView rows={result.rows} meta={readRunMeta(result.meta)} definition={definition} />
  }
  const tiles = 'tiles' in result && Array.isArray(result.tiles) ? result.tiles : []
  if (tiles.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('reports.embed.empty', 'No data.')}</p>
  }
  return (
    <div className="space-y-3">
      {tiles.map((tile) =>
        'error' in tile ? (
          <div key={tile.tileId} className="rounded-md border border-status-warning-border bg-status-warning-bg px-3 py-2 text-sm text-status-warning-text">
            {tile.error?.message ?? t('reports.embed.error.run', 'Failed to render embed.')}
          </div>
        ) : (
          <ReportResultView key={tile.tileId} rows={tile.rows} meta={readRunMeta(tile.meta)} />
        ),
      )}
    </div>
  )
}

export type { EmbedRow }
export { resolveParams, inferRecordId, SPOT_TO_ENTITY }
export type { ChartSpec }
