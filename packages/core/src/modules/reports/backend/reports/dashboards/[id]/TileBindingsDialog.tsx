"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ParameterDef } from '@open-mercato/shared/modules/reports/dsl'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { ParameterValueInput, parameterLabel } from '../../../../widgets/injection/record-embed-host/ParameterValueInput'

export type TileBinding =
  | { source: 'literal'; value: unknown }
  | { source: 'parameter'; parameter: string }
  | { source: 'record-field'; recordField: string }

export type TileBindings = Record<string, TileBinding>

type TileBindingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tileTitle: string
  reportParameters: readonly ParameterDef[]
  dashboardParameters: readonly ParameterDef[]
  value: TileBindings
  onApply: (next: TileBindings) => void
}

const INHERIT = '__inherit__'
const FIXED = '__fixed__'

/**
 * Per-tile parameter overrides. By default a tile receives the dashboard
 * parameter of the same key; a row can instead read another dashboard
 * parameter or use a fixed value.
 */
export function TileBindingsDialog({
  open,
  onOpenChange,
  tileTitle,
  reportParameters,
  dashboardParameters,
  value,
  onApply,
}: TileBindingsDialogProps) {
  const t = useT()
  const [draft, setDraft] = React.useState<TileBindings>(value)

  React.useEffect(() => {
    if (open) setDraft(value)
  }, [open, value])

  const apply = React.useCallback(() => {
    const cleaned: TileBindings = {}
    for (const [key, binding] of Object.entries(draft)) {
      if (binding.source === 'literal' && (binding.value === undefined || binding.value === '')) continue
      cleaned[key] = binding
    }
    onApply(cleaned)
    onOpenChange(false)
  }, [draft, onApply, onOpenChange])

  const sourceValue = (binding: TileBinding | undefined): string => {
    if (!binding) return INHERIT
    if (binding.source === 'literal') return FIXED
    if (binding.source === 'parameter') return `param:${binding.parameter}`
    return INHERIT
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            apply()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('reports.dashboards.detail.bindings.title', 'Tile parameters')}</DialogTitle>
          <DialogDescription>
            {t('reports.dashboards.detail.bindings.description', 'By default "{tile}" uses the dashboard parameter with the same key. Override a parameter for this tile only.', { tile: tileTitle })}
          </DialogDescription>
        </DialogHeader>
        {reportParameters.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('reports.dashboards.detail.bindings.none', 'This report declares no parameters.')}
          </p>
        ) : (
          <ul className="space-y-3">
            {reportParameters.map((param) => {
              const binding = draft[param.key]
              const inherits = dashboardParameters.some((dashboardParam) => dashboardParam.key === param.key)
              return (
                <li key={param.key} className="space-y-2 rounded-md border border-border/60 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{parameterLabel(param, t)}</span>
                    <span className="font-mono text-xs text-muted-foreground">{param.key}</span>
                  </div>
                  <Select
                    value={sourceValue(binding)}
                    onValueChange={(next) => {
                      setDraft((prev) => {
                        const copy = { ...prev }
                        if (next === INHERIT) delete copy[param.key]
                        else if (next === FIXED) copy[param.key] = { source: 'literal', value: param.defaultValue }
                        else if (next.startsWith('param:')) copy[param.key] = { source: 'parameter', parameter: next.slice('param:'.length) }
                        return copy
                      })
                    }}
                  >
                    <SelectTrigger aria-label={t('reports.dashboards.detail.bindings.source', 'Value source')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={INHERIT}>
                        {inherits
                          ? t('reports.dashboards.detail.bindings.inherit', 'Dashboard parameter (same key)')
                          : t('reports.dashboards.detail.bindings.reportDefault', 'Report default')}
                      </SelectItem>
                      {dashboardParameters
                        .filter((dashboardParam) => dashboardParam.key !== param.key)
                        .map((dashboardParam) => (
                          <SelectItem key={dashboardParam.key} value={`param:${dashboardParam.key}`}>
                            {t('reports.dashboards.detail.bindings.fromParameter', 'Dashboard parameter: {name}', { name: parameterLabel(dashboardParam, t) })}
                          </SelectItem>
                        ))}
                      <SelectItem value={FIXED}>{t('reports.dashboards.detail.bindings.fixed', 'Fixed value')}</SelectItem>
                    </SelectContent>
                  </Select>
                  {binding?.source === 'literal' ? (
                    <ParameterValueInput
                      param={param}
                      value={binding.value}
                      onChange={(next) => setDraft((prev) => ({ ...prev, [param.key]: { source: 'literal', value: next } }))}
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('reports.dashboards.detail.bindings.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={apply}>
            {t('reports.dashboards.detail.bindings.apply', 'Apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

