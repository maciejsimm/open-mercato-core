"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'

const SUGGESTED_SPOTS = [
  'detail:customers.person:after-header',
  'detail:customers.company:after-header',
]

const embedNewSchema = z.object({
  hostSpotId: z.string().trim().min(1).max(200),
  hostEntityId: z.string().trim().min(1).max(120),
  artifactType: z.enum(['report', 'dashboard']),
  artifactId: z.string().uuid({ message: 'Pick a report or dashboard' }),
  displayTitle: z.string().trim().max(200).optional().or(z.literal('')),
  recordFieldBindings: z.string().trim().max(2000).optional().or(z.literal('')),
})
type EmbedNewValues = z.infer<typeof embedNewSchema>

type Option = { id: string; name: string }

function parseRecordFieldBindings(input: string | undefined | null): Record<string, { source: 'record-field'; recordField: string }> {
  if (!input || !input.trim()) return {}
  const out: Record<string, { source: 'record-field'; recordField: string }> = {}
  for (const pair of input.split(',')) {
    const [key, value] = pair.split('=').map((s) => s.trim())
    if (key && value) out[key] = { source: 'record-field', recordField: value }
  }
  return out
}

export default function EmbedsNewPage() {
  const router = useRouter()
  const t = useT()

  const [artifactType, setArtifactType] = React.useState<'report' | 'dashboard'>('report')
  const [reportsCache, setReportsCache] = React.useState<Option[] | null>(null)
  const [dashboardsCache, setDashboardsCache] = React.useState<Option[] | null>(null)

  const loadArtifactOptions = React.useCallback(async () => {
    if (artifactType === 'report') {
      if (reportsCache) return reportsCache.map((r) => ({ value: r.id, label: r.name }))
      const call = await apiCall<{ items?: Option[] }>('/api/reports/reports?pageSize=100', undefined, { fallback: { items: [] } })
      const items = call.ok && Array.isArray(call.result?.items) ? call.result!.items! : []
      setReportsCache(items)
      return items.map((r) => ({ value: r.id, label: r.name }))
    }
    if (dashboardsCache) return dashboardsCache.map((d) => ({ value: d.id, label: d.name }))
    const call = await apiCall<{ items?: Option[] }>('/api/reports/dashboards?pageSize=100', undefined, { fallback: { items: [] } })
    const items = call.ok && Array.isArray(call.result?.items) ? call.result!.items! : []
    setDashboardsCache(items)
    return items.map((d) => ({ value: d.id, label: d.name }))
  }, [artifactType, reportsCache, dashboardsCache])

  const fields: CrudField[] = React.useMemo(() => [
    {
      id: 'hostSpotId',
      label: t('reports.embeds.new.fields.hostSpotId', 'Host spot id'),
      type: 'text',
      required: true,
      description: t(
        'reports.embeds.new.fields.hostSpotIdHint',
        'Widget spot the embed lives in (e.g. `detail:customers.person:after-header`).',
      ),
      placeholder: SUGGESTED_SPOTS.join(' or '),
    },
    {
      id: 'hostEntityId',
      label: t('reports.embeds.new.fields.hostEntityId', 'Host entity id'),
      type: 'text',
      required: true,
      description: t(
        'reports.embeds.new.fields.hostEntityIdHint',
        'Entity slug the host page renders (e.g. `customers.person`).',
      ),
    },
    {
      id: 'artifactType',
      label: t('reports.embeds.new.fields.artifactType', 'Artifact'),
      type: 'select',
      required: true,
      options: [
        { value: 'report', label: t('reports.embeds.new.artifactType.report', 'Report') },
        { value: 'dashboard', label: t('reports.embeds.new.artifactType.dashboard', 'Dashboard') },
      ],
      onChange: (value: unknown) => {
        if (value === 'report' || value === 'dashboard') setArtifactType(value)
      },
    },
    {
      id: 'artifactId',
      label: artifactType === 'dashboard'
        ? t('reports.embeds.new.fields.dashboard', 'Dashboard')
        : t('reports.embeds.new.fields.report', 'Report'),
      type: 'select',
      required: true,
      loadOptions: loadArtifactOptions,
      // re-key the picker when artifactType changes so the cache reload kicks in
      key: artifactType,
    } as CrudField,
    {
      id: 'displayTitle',
      label: t('reports.embeds.new.fields.displayTitle', 'Display title'),
      type: 'text',
      description: t(
        'reports.embeds.new.fields.displayTitleHint',
        'Optional: overrides the artifact name in the embed card.',
      ),
    },
    {
      id: 'recordFieldBindings',
      label: t('reports.embeds.new.fields.recordFieldBindings', 'Record-field bindings'),
      type: 'textarea',
      description: t(
        'reports.embeds.new.fields.recordFieldBindingsHint',
        'Comma-separated `paramKey = recordField` pairs (e.g. `companyId = id, ownerId = ownerUserId`). Each binding pulls its value from the host record at render time.',
      ),
    },
  ], [artifactType, loadArtifactOptions, t])

  const handleSubmit = React.useCallback(async (values: EmbedNewValues) => {
    try {
      const payload = {
        hostSpotId: values.hostSpotId.trim(),
        hostEntityId: values.hostEntityId.trim(),
        artifactType: values.artifactType,
        artifactId: values.artifactId,
        paramBindings: parseRecordFieldBindings(values.recordFieldBindings),
        displayTitle: values.displayTitle?.trim() ? values.displayTitle.trim() : null,
        position: 0,
        enabled: true,
      }
      const response = await readApiResultOrThrow<{ id: string }>(
        '/api/reports/embeds',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!response?.id) {
        throw createCrudFormError(t('reports.embeds.new.error.create', 'Failed to create embed.'))
      }
      flash(t('reports.embeds.new.success', 'Embed created.'), 'success')
      router.push('/backend/reports/embeds')
    } catch (err) {
      if (err && typeof err === 'object' && 'message' in err) throw err
      throw createCrudFormError(t('reports.embeds.new.error.create', 'Failed to create embed.'))
    }
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <CrudForm<EmbedNewValues>
          title={t('reports.embeds.new.pageTitle', 'New Embed')}
          schema={embedNewSchema}
          fields={fields}
          initialValues={{ artifactType: 'report' } as Partial<EmbedNewValues>}
          submitLabel={t('reports.embeds.new.actions.create', 'Create embed')}
          cancelHref="/backend/reports/embeds"
          backHref="/backend/reports/embeds"
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
