"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { KbdShortcut, Kbd } from '@open-mercato/ui/primitives/kbd'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { StepIndicator, type StepIndicatorStep } from '@open-mercato/ui/primitives/step-indicator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ParameterDef } from '@open-mercato/shared/modules/reports/dsl'
import { ArrowLeft, Save } from 'lucide-react'
import {
  EMBED_HOST_SPOTS,
  draftsToBindings,
  getEmbedHostSpot,
  readHostRecordField,
  readParameterDefs,
  suggestBindingDraft,
  validateEmbedConfig,
  type EmbedBindingDraft,
  type EmbedBindings,
  type EmbedConfigIssue,
  type EmbedHostSpot,
} from '../../../../lib/embed-spots'
import { EmbedCard } from '../../../../widgets/injection/record-embed-host/widget.client'
import { ParameterValueInput, parameterLabel } from '../../../../widgets/injection/record-embed-host/ParameterValueInput'

type ArtifactType = 'report' | 'dashboard'

type ArtifactOption = {
  id: string
  name: string
  type: ArtifactType
  parameters: ParameterDef[]
}

type ArtifactListItem = { id: string; name: string; parameters?: unknown }

type StoredEmbed = {
  id: string
  hostSpotId: string
  artifactType: ArtifactType
  artifactId: string
  paramBindings: EmbedBindings
  displayTitle: string | null
  position: number
  enabled: boolean
  updatedAt: string | null
}

type SampleRecord = { id: string; label: string }

const LIST_HREF = '/backend/reports/embeds'

function toArtifactOptions(items: ArtifactListItem[] | undefined, type: ArtifactType): ArtifactOption[] {
  return (items ?? []).map((item) => ({ id: item.id, name: item.name, type, parameters: readParameterDefs(item.parameters) }))
}

function readSampleLabel(item: Record<string, unknown>): string {
  for (const key of ['display_name', 'displayName', 'name', 'primary_email']) {
    const value = item[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return String(item.id ?? '')
}

export default function EmbedConfiguratorPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editId = searchParams?.get('id') ?? null
  const t = useT()
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({ contextId: 'reports.embed.configurator' })

  const [artifacts, setArtifacts] = React.useState<ArtifactOption[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [stored, setStored] = React.useState<StoredEmbed | null>(null)

  const [spotId, setSpotId] = React.useState<string>('')
  const [artifactType, setArtifactType] = React.useState<ArtifactType>('report')
  const [artifactId, setArtifactId] = React.useState<string>('')
  const [drafts, setDrafts] = React.useState<Record<string, EmbedBindingDraft>>({})
  const [displayTitle, setDisplayTitle] = React.useState('')
  const [position, setPosition] = React.useState(0)
  const [enabled, setEnabled] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [serverIssues, setServerIssues] = React.useState<EmbedConfigIssue[]>([])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const [reportsCall, dashboardsCall, embedCall] = await Promise.all([
          apiCall<{ items?: ArtifactListItem[] }>('/api/reports/reports?pageSize=100', undefined, { fallback: { items: [] } }),
          apiCall<{ items?: ArtifactListItem[] }>('/api/reports/dashboards?pageSize=100', undefined, { fallback: { items: [] } }),
          editId
            ? apiCall<{ items?: StoredEmbed[] }>(`/api/reports/embeds?id=${encodeURIComponent(editId)}&pageSize=1`, undefined, { fallback: { items: [] } })
            : Promise.resolve(null),
        ])
        if (cancelled) return
        setArtifacts([
          ...toArtifactOptions(reportsCall.ok ? reportsCall.result?.items : [], 'report'),
          ...toArtifactOptions(dashboardsCall.ok ? dashboardsCall.result?.items : [], 'dashboard'),
        ])
        if (embedCall) {
          const found = embedCall.ok ? embedCall.result?.items?.[0] : undefined
          if (!found) {
            setLoadError(t('reports.embeds.configurator.error.notFound', 'Embed not found.'))
            return
          }
          setStored(found)
          setSpotId(found.hostSpotId)
          setArtifactType(found.artifactType)
          setArtifactId(found.artifactId)
          setDisplayTitle(found.displayTitle ?? '')
          setPosition(found.position)
          setEnabled(found.enabled)
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : t('reports.embeds.configurator.error.load', 'Failed to load the configurator.'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [editId, t])

  const spot = getEmbedHostSpot(spotId)
  const artifact = artifacts.find((item) => item.id === artifactId && item.type === artifactType)
  const parameters = React.useMemo(() => artifact?.parameters ?? [], [artifact])

  React.useEffect(() => {
    if (!artifact) {
      setDrafts({})
      return
    }
    const existing = stored && stored.artifactId === artifact.id ? stored.paramBindings : undefined
    setDrafts((prev) => {
      const next: Record<string, EmbedBindingDraft> = {}
      for (const param of artifact.parameters) {
        const kept = prev[param.key]
        next[param.key] = kept && kept.source !== 'none' ? kept : suggestBindingDraft(spot, param, existing?.[param.key])
      }
      return next
    })
  }, [artifact, spot, stored])

  const bindings = React.useMemo(() => draftsToBindings(drafts), [drafts])
  const issues = React.useMemo(
    () => (spot && artifact ? validateEmbedConfig({ hostSpotId: spot.spotId, paramBindings: bindings, parameters }) : []),
    [artifact, bindings, parameters, spot],
  )
  const issuesByParam = React.useMemo(() => {
    const map = new Map<string, EmbedConfigIssue[]>()
    for (const issue of [...issues, ...serverIssues]) {
      if (!issue.param) continue
      map.set(issue.param, [...(map.get(issue.param) ?? []), issue])
    }
    return map
  }, [issues, serverIssues])

  const canSave = Boolean(spot && artifact) && issues.length === 0 && !isSaving

  const issueMessage = React.useCallback(
    (issue: EmbedConfigIssue) => t(`reports.embeds.validation.${issue.code}`, issue.message),
    [t],
  )

  const handleSave = React.useCallback(async () => {
    if (!spot || !artifact || issues.length > 0 || isSaving) return
    setIsSaving(true)
    setServerIssues([])
    const payload: Record<string, unknown> = {
      hostSpotId: spot.spotId,
      hostEntityId: spot.hostEntityId,
      artifactType: artifact.type,
      artifactId: artifact.id,
      paramBindings: bindings,
      displayTitle: displayTitle.trim() ? displayTitle.trim() : null,
      position,
      enabled,
    }
    if (stored) payload.id = stored.id
    try {
      await runMutation({
        operation: () =>
          readApiResultOrThrow<{ id?: string; ok?: boolean }>('/api/reports/embeds', {
            method: stored ? 'PUT' : 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }),
        context: { formId: 'reports.embed.configurator', resourceKind: 'reports.embed', resourceId: stored?.id },
        mutationPayload: payload,
      })
      flash(stored ? t('reports.embeds.configurator.success.update', 'Embed saved.') : t('reports.embeds.new.success', 'Embed created.'), 'success')
      router.push(LIST_HREF)
    } catch (err) {
      const reported = err && typeof err === 'object' && 'issues' in err ? (err as { issues?: unknown }).issues : undefined
      if (Array.isArray(reported)) setServerIssues(reported as EmbedConfigIssue[])
      const message = err instanceof Error && err.message ? err.message : t('reports.embeds.new.error.create', 'Failed to create embed.')
      flash(message, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [artifact, bindings, displayTitle, enabled, isSaving, issues.length, position, router, runMutation, spot, stored, t])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void handleSave()
        return
      }
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[data-radix-popper-content-wrapper]')) {
        router.push(LIST_HREF)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave, router])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('reports.embeds.configurator.loading', 'Loading…')} />
        </PageBody>
      </Page>
    )
  }

  if (loadError) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={loadError} />
        </PageBody>
      </Page>
    )
  }

  const parametersDone = Boolean(spot && artifact) && issues.length === 0
  const steps: StepIndicatorStep[] = [
    { id: 'where', label: t('reports.embeds.configurator.steps.where', 'Where'), status: spot ? 'complete' : 'current' },
    { id: 'what', label: t('reports.embeds.configurator.steps.what', 'What'), status: artifact ? 'complete' : spot ? 'current' : 'pending' },
    {
      id: 'parameters',
      label: t('reports.embeds.configurator.steps.parameters', 'Parameters'),
      status: parametersDone ? 'complete' : spot && artifact ? (issues.length > 0 ? 'error' : 'current') : 'pending',
    },
  ]
  const visibleArtifacts = artifacts.filter((item) => item.type === artifactType)

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button asChild variant="ghost" size="sm">
                <Link href={LIST_HREF}>
                  <ArrowLeft className="size-4" aria-hidden />
                  <span>{t('reports.embeds.configurator.back', 'Back to embeds')}</span>
                </Link>
              </Button>
              <h1 className="text-xl font-semibold text-foreground">
                {stored ? t('reports.embeds.configurator.editTitle', 'Edit embed') : t('reports.embeds.new.pageTitle', 'New Embed')}
              </h1>
            </div>
            <StepIndicator steps={steps} size="sm" />
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <div className="flex flex-col gap-6 lg:col-span-3">
              <section className="space-y-3 rounded-md border border-border bg-card p-4">
                <h2 className="text-sm font-semibold text-foreground">
                  {t('reports.embeds.configurator.where.title', '1. Where should it appear?')}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t('reports.embeds.configurator.where.hint', 'Pick the record page that shows the embed, below its header.')}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {EMBED_HOST_SPOTS.map((candidate) => (
                    <Button
                      key={candidate.spotId}
                      type="button"
                      variant={candidate.spotId === spotId ? 'default' : 'outline'}
                      className="justify-start"
                      aria-pressed={candidate.spotId === spotId}
                      onClick={() => setSpotId(candidate.spotId)}
                    >
                      {t(candidate.labelKey, candidate.label)}
                    </Button>
                  ))}
                </div>
              </section>

              <section className="space-y-3 rounded-md border border-border bg-card p-4">
                <h2 className="text-sm font-semibold text-foreground">
                  {t('reports.embeds.configurator.what.title', '2. What should it show?')}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t('reports.embeds.configurator.what.hint', 'Only reports and dashboards you can view are listed. Viewers still need access to see the embed.')}
                </p>
                <SegmentedControl
                  value={artifactType}
                  onValueChange={(value) => {
                    if (value === 'report' || value === 'dashboard') {
                      setArtifactType(value)
                      setArtifactId('')
                    }
                  }}
                  aria-label={t('reports.embeds.new.fields.artifactType', 'Artifact')}
                >
                  <SegmentedControlItem value="report">{t('reports.embeds.new.artifactType.report', 'Report')}</SegmentedControlItem>
                  <SegmentedControlItem value="dashboard">{t('reports.embeds.new.artifactType.dashboard', 'Dashboard')}</SegmentedControlItem>
                </SegmentedControl>
                {visibleArtifacts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {artifactType === 'dashboard'
                      ? t('reports.embeds.configurator.what.noDashboards', 'No dashboards you can view.')
                      : t('reports.embeds.configurator.what.noReports', 'No reports you can view.')}
                  </p>
                ) : (
                  <Select value={artifactId || undefined} onValueChange={setArtifactId}>
                    <SelectTrigger aria-label={artifactType === 'dashboard' ? t('reports.embeds.new.fields.dashboard', 'Dashboard') : t('reports.embeds.new.fields.report', 'Report')}>
                      <SelectValue placeholder={t('reports.embeds.configurator.what.placeholder', 'Choose…')} />
                    </SelectTrigger>
                    <SelectContent>
                      {visibleArtifacts.map((item) => (
                        <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </section>

              <section className="space-y-3 rounded-md border border-border bg-card p-4">
                <h2 className="text-sm font-semibold text-foreground">
                  {t('reports.embeds.configurator.parameters.title', '3. Parameters')}
                </h2>
                {!spot || !artifact ? (
                  <p className="text-sm text-muted-foreground">
                    {t('reports.embeds.configurator.parameters.pending', 'Pick a record page and an artifact first.')}
                  </p>
                ) : parameters.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('reports.embeds.configurator.parameters.none', 'This artifact declares no parameters; it renders the same for every record.')}
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {parameters.map((param) => (
                      <ParameterRow
                        key={param.key}
                        param={param}
                        spot={spot}
                        draft={drafts[param.key] ?? { source: 'none' }}
                        issues={issuesByParam.get(param.key) ?? []}
                        issueMessage={issueMessage}
                        onChange={(draft) => {
                          setServerIssues([])
                          setDrafts((prev) => ({ ...prev, [param.key]: draft }))
                        }}
                      />
                    ))}
                  </ul>
                )}
                {issues.filter((issue) => !issue.param).map((issue) => (
                  <p key={issue.code} className="text-sm text-status-error-text">{issueMessage(issue)}</p>
                ))}
              </section>

              <section className="space-y-3 rounded-md border border-border bg-card p-4">
                <h2 className="text-sm font-semibold text-foreground">
                  {t('reports.embeds.configurator.details.title', 'Display')}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="embed-display-title">{t('reports.embeds.new.fields.displayTitle', 'Display title')}</Label>
                    <Input
                      id="embed-display-title"
                      value={displayTitle}
                      placeholder={artifact?.name}
                      onChange={(event) => setDisplayTitle(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="embed-position">{t('reports.embeds.configurator.details.position', 'Position')}</Label>
                    <Input
                      id="embed-position"
                      type="number"
                      min={0}
                      max={1000}
                      value={String(position)}
                      onChange={(event) => {
                        const parsed = Number(event.target.value)
                        setPosition(Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, 1000) : 0)
                      }}
                    />
                  </div>
                </div>
                <SwitchField
                  label={t('reports.embeds.list.columns.enabled', 'Enabled')}
                  checked={enabled}
                  onCheckedChange={(checked) => setEnabled(checked === true)}
                />
              </section>

              <div className="flex flex-wrap items-center justify-end gap-3">
                <span className="text-xs text-muted-foreground">
                  <KbdShortcut keys={['⌘/Ctrl', 'Enter']} /> · <Kbd>Esc</Kbd>
                </span>
                <Button asChild variant="outline">
                  <Link href={LIST_HREF}>{t('reports.embeds.configurator.cancel', 'Cancel')}</Link>
                </Button>
                <Button type="button" onClick={() => void handleSave()} disabled={!canSave}>
                  <Save className="size-4" aria-hidden />
                  <span>
                    {isSaving
                      ? t('reports.embeds.configurator.saving', 'Saving…')
                      : t('reports.embeds.configurator.save', 'Save embed')}
                  </span>
                </Button>
              </div>
            </div>

            <div className="lg:col-span-2">
              <EmbedPreview spot={spot} artifact={artifact} bindings={bindings} displayTitle={displayTitle} ready={parametersDone} />
            </div>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}

type ParameterRowProps = {
  param: ParameterDef
  spot: EmbedHostSpot
  draft: EmbedBindingDraft
  issues: EmbedConfigIssue[]
  issueMessage: (issue: EmbedConfigIssue) => string
  onChange: (draft: EmbedBindingDraft) => void
}

function ParameterRow({ param, spot, draft, issues, issueMessage, onChange }: ParameterRowProps) {
  const t = useT()
  const inputId = `embed-param-${param.key}`
  return (
    <li className="space-y-2 rounded-md border border-border/60 bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{parameterLabel(param, t)}</span>
          <span className="font-mono text-xs text-muted-foreground">{param.key}</span>
          <span className="text-xs text-muted-foreground">· {t(`reports.parameters.kind.${param.kind}`, param.kind)}</span>
          {param.required ? (
            <span className="text-xs text-status-warning-text">{t('reports.embeds.configurator.parameters.required', 'Required')}</span>
          ) : null}
        </div>
        <SegmentedControl
          value={draft.source}
          onValueChange={(value) => {
            if (value === 'record-field') onChange({ source: 'record-field', recordField: '' })
            else if (value === 'literal') onChange({ source: 'literal', value: undefined })
            else if (value === 'none') onChange({ source: 'none' })
          }}
          aria-label={t('reports.embeds.configurator.parameters.source', 'Value source')}
        >
          <SegmentedControlItem value="record-field">{t('reports.embeds.configurator.parameters.fromRecord', 'From this record')}</SegmentedControlItem>
          <SegmentedControlItem value="literal">{t('reports.embeds.configurator.parameters.fixed', 'Fixed value')}</SegmentedControlItem>
          <SegmentedControlItem value="none">{t('reports.embeds.configurator.parameters.unbound', 'Not set')}</SegmentedControlItem>
        </SegmentedControl>
      </div>
      {draft.source === 'record-field' ? (
        <Select
          value={draft.recordField || undefined}
          onValueChange={(recordField) => onChange({ source: 'record-field', recordField })}
        >
          <SelectTrigger id={inputId} aria-label={t('reports.embeds.configurator.parameters.recordField', 'Record field')}>
            <SelectValue placeholder={t('reports.embeds.configurator.parameters.pickField', 'Pick a field of the record')} />
          </SelectTrigger>
          <SelectContent>
            {spot.fields.map((field) => (
              <SelectItem key={field.path} value={field.path}>{t(field.labelKey, field.label)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : draft.source === 'literal' ? (
        <ParameterValueInput id={inputId} param={param} value={draft.value} onChange={(value) => onChange({ source: 'literal', value })} />
      ) : null}
      {issues.map((issue) => (
        <p key={`${issue.code}-${issue.path}`} className="text-xs text-status-error-text">{issueMessage(issue)}</p>
      ))}
    </li>
  )
}

type EmbedPreviewProps = {
  spot: EmbedHostSpot | undefined
  artifact: ArtifactOption | undefined
  bindings: EmbedBindings
  displayTitle: string
  ready: boolean
}

function EmbedPreview({ spot, artifact, bindings, displayTitle, ready }: EmbedPreviewProps) {
  const t = useT()
  const [samples, setSamples] = React.useState<SampleRecord[]>([])
  const [sampleId, setSampleId] = React.useState<string>('')
  const [hostData, setHostData] = React.useState<unknown>(null)
  const [sampleError, setSampleError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setSamples([])
    setSampleId('')
    setHostData(null)
    setSampleError(null)
    if (!spot) return
    let cancelled = false
    apiCall<{ items?: Array<Record<string, unknown>> }>(spot.sampleListPath, undefined, { fallback: { items: [] } })
      .then((call) => {
        if (cancelled) return
        const items = call.ok && Array.isArray(call.result?.items) ? call.result!.items! : []
        const list = items
          .filter((item) => typeof item.id === 'string')
          .map((item) => ({ id: String(item.id), label: readSampleLabel(item) }))
        setSamples(list)
        setSampleId(list[0]?.id ?? '')
      })
      .catch(() => {
        if (!cancelled) setSampleError(t('reports.embeds.configurator.preview.sampleError', 'Could not load a sample record.'))
      })
    return () => { cancelled = true }
  }, [spot, t])

  React.useEffect(() => {
    if (!spot || !sampleId) return
    let cancelled = false
    apiCall<Record<string, unknown>>(spot.sampleDetailPath(sampleId), undefined, { fallback: {} })
      .then((call) => {
        if (cancelled) return
        if (!call.ok) {
          setSampleError(t('reports.embeds.configurator.preview.sampleError', 'Could not load a sample record.'))
          return
        }
        setHostData(call.result ?? null)
      })
      .catch(() => {
        if (!cancelled) setSampleError(t('reports.embeds.configurator.preview.sampleError', 'Could not load a sample record.'))
      })
    return () => { cancelled = true }
  }, [sampleId, spot, t])

  const boundValues = Object.entries(bindings).filter(([, binding]) => binding.source === 'record-field')

  return (
    <section className="sticky top-4 space-y-3 rounded-md border border-border bg-muted/30 p-4">
      <h2 className="text-sm font-semibold text-foreground">{t('reports.embeds.configurator.preview.title', 'Preview')}</h2>
      {!spot ? (
        <p className="text-sm text-muted-foreground">{t('reports.embeds.configurator.preview.pickSpot', 'Pick a record page to preview the embed.')}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {t('reports.embeds.configurator.preview.location', 'Shown below the header of every {page} page.').replace('{page}', t(spot.labelKey, spot.label))}
          </p>
          {sampleError ? (
            <p className="text-sm text-status-warning-text">{sampleError}</p>
          ) : samples.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('reports.embeds.configurator.preview.noSample', 'No records yet to preview against.')}</p>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="embed-preview-sample">{t('reports.embeds.configurator.preview.sample', 'Sample record')}</Label>
              <Select value={sampleId || undefined} onValueChange={setSampleId}>
                <SelectTrigger id="embed-preview-sample">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {samples.map((sample) => (
                    <SelectItem key={sample.id} value={sample.id}>{sample.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {hostData && boundValues.length > 0 ? (
            <dl className="space-y-1 text-xs">
              {boundValues.map(([paramKey, binding]) => {
                if (binding.source !== 'record-field') return null
                const value = readHostRecordField(hostData, binding.recordField)
                return (
                  <div key={paramKey} className="flex gap-2">
                    <dt className="font-mono text-muted-foreground">{paramKey}</dt>
                    <dd className="text-foreground">{value === undefined || value === null || value === '' ? '—' : String(value)}</dd>
                  </div>
                )
              })}
            </dl>
          ) : null}
          {!artifact ? (
            <p className="text-sm text-muted-foreground">{t('reports.embeds.configurator.preview.pickArtifact', 'Pick a report or dashboard to see it here.')}</p>
          ) : !ready ? (
            <p className="text-sm text-muted-foreground">{t('reports.embeds.configurator.preview.fixParameters', 'Bind the required parameters to see the preview.')}</p>
          ) : hostData ? (
            <EmbedCard
              artifactType={artifact.type}
              artifactId={artifact.id}
              paramBindings={bindings}
              displayTitle={displayTitle.trim() || null}
              hostData={hostData}
            />
          ) : null}
        </>
      )}
    </section>
  )
}
