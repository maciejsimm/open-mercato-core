"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import type { ParameterDef } from '@open-mercato/shared/modules/reports/dsl'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { readParameterDefs } from '../../../lib/embed-spots'
import { EmbedCard } from '../../injection/record-embed-host/widget.client'
import { ParameterValueInput, parameterLabel } from '../../injection/record-embed-host/ParameterValueInput'
import {
  DEFAULT_SETTINGS,
  hydrateReportWidgetSettings,
  settingsToBindings,
  type ReportWidgetArtifactType,
  type ReportWidgetSettings,
} from './config'

type ArtifactOption = {
  id: string
  name: string
  parameters: ParameterDef[]
}

type ArtifactListItem = { id?: unknown; name?: unknown; parameters?: unknown }

function toArtifactOptions(items: ArtifactListItem[] | undefined): ArtifactOption[] {
  const out: ArtifactOption[] = []
  for (const item of items ?? []) {
    if (typeof item.id !== 'string') continue
    out.push({
      id: item.id,
      name: typeof item.name === 'string' && item.name.length > 0 ? item.name : item.id,
      parameters: readParameterDefs(item.parameters),
    })
  }
  return out
}

function listPath(artifactType: ReportWidgetArtifactType): string {
  return artifactType === 'dashboard' ? '/api/reports/dashboards?pageSize=100' : '/api/reports/reports?pageSize=100'
}

function useArtifactOptions(artifactType: ReportWidgetArtifactType, enabled: boolean) {
  const [options, setOptions] = React.useState<ArtifactOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    setFailed(false)
    apiCall<{ items?: ArtifactListItem[] }>(listPath(artifactType), undefined, { fallback: { items: [] } })
      .then((call) => {
        if (cancelled) return
        if (!call.ok) {
          setFailed(true)
          setOptions([])
          return
        }
        setOptions(toArtifactOptions(call.result?.items))
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [artifactType, enabled])

  return { options, loading, failed }
}

type SettingsFormProps = {
  settings: ReportWidgetSettings
  onChange: (next: ReportWidgetSettings) => void
}

function ReportWidgetSettingsForm({ settings, onChange }: SettingsFormProps) {
  const t = useT()
  const { options, loading, failed } = useArtifactOptions(settings.artifactType, true)
  const selected = options.find((option) => option.id === settings.artifactId)
  const parameters = selected?.parameters ?? []

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-1.5">
        <Label htmlFor="reports-widget-artifact-type">{t('reports.dashboardWidget.settings.type', 'Show')}</Label>
        <Select
          value={settings.artifactType}
          onValueChange={(value) => {
            if (value !== 'report' && value !== 'dashboard') return
            if (value === settings.artifactType) return
            onChange({ ...settings, artifactType: value, artifactId: null, params: {} })
          }}
        >
          <SelectTrigger id="reports-widget-artifact-type" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="report">{t('reports.dashboardWidget.settings.typeReport', 'Report')}</SelectItem>
            <SelectItem value="dashboard">{t('reports.dashboardWidget.settings.typeDashboard', 'Report dashboard')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reports-widget-artifact">
          {settings.artifactType === 'dashboard'
            ? t('reports.dashboardWidget.settings.dashboard', 'Report dashboard')
            : t('reports.dashboardWidget.settings.report', 'Report')}
        </Label>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Spinner className="size-4" />
            <span>{t('reports.dashboardWidget.settings.loading', 'Loading…')}</span>
          </div>
        ) : failed ? (
          <p className="text-status-error-text">{t('reports.dashboardWidget.settings.loadError', 'Could not load reports.')}</p>
        ) : options.length === 0 ? (
          <p className="text-muted-foreground">{t('reports.dashboardWidget.settings.noArtifacts', 'There is nothing you can view yet.')}</p>
        ) : (
          <Select
            value={settings.artifactId ?? undefined}
            onValueChange={(value) => {
              if (value === settings.artifactId) return
              onChange({ ...settings, artifactId: value, params: {} })
            }}
          >
            <SelectTrigger id="reports-widget-artifact" size="sm">
              <SelectValue placeholder={t('reports.dashboardWidget.settings.pick', 'Pick one')} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {settings.artifactId && !loading && !failed && options.length > 0 && !selected ? (
          <p className="text-xs text-status-warning-text">
            {t('reports.dashboardWidget.settings.unavailable', 'The selected item is no longer available to you. Pick another one.')}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reports-widget-title">{t('reports.dashboardWidget.settings.title', 'Heading (optional)')}</Label>
        <Input
          id="reports-widget-title"
          value={settings.title}
          maxLength={200}
          placeholder={selected?.name ?? ''}
          onChange={(event) => onChange({ ...settings, title: event.target.value })}
        />
      </div>

      {selected ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            {t('reports.dashboardWidget.settings.parameters', 'Parameter values')}
          </p>
          {parameters.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('reports.dashboardWidget.settings.noParameters', 'This one has no parameters.')}
            </p>
          ) : (
            <ul className="space-y-3">
              {parameters.map((param) => {
                const inputId = `reports-widget-param-${param.key}`
                return (
                  <li key={param.key} className="space-y-1">
                    <Label htmlFor={inputId}>
                      {parameterLabel(param, t)}
                      {param.required ? (
                        <span className="ml-2 text-xs text-status-warning-text">
                          {t('reports.embeds.configurator.parameters.required', 'Required')}
                        </span>
                      ) : null}
                    </Label>
                    <ParameterValueInput
                      id={inputId}
                      param={param}
                      value={settings.params[param.key]}
                      onChange={(value) => onChange({ ...settings, params: { ...settings.params, [param.key]: value } })}
                    />
                  </li>
                )
              })}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            {t('reports.dashboardWidget.settings.parametersHint', 'Leave a value empty to use the default.')}
          </p>
        </div>
      ) : null}
    </div>
  )
}

const ReportDashboardWidget: React.FC<DashboardWidgetComponentProps<ReportWidgetSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateReportWidgetSettings(settings), [settings])
  const bindings = React.useMemo(() => settingsToBindings(hydrated), [hydrated])

  if (mode === 'settings') {
    return <ReportWidgetSettingsForm settings={hydrated} onChange={onSettingsChange} />
  }

  if (!hydrated.artifactId) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('reports.dashboardWidget.empty', 'Pick a report or report dashboard in this widget\'s settings.')}
      </p>
    )
  }

  return (
    <EmbedCard
      bare
      artifactType={hydrated.artifactType}
      artifactId={hydrated.artifactId}
      paramBindings={bindings}
      displayTitle={hydrated.title.trim() || null}
      hostData={null}
      refreshToken={refreshToken}
      onRunningChange={onRefreshStateChange}
    />
  )
}

export default ReportDashboardWidget
