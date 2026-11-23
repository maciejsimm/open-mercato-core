"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ParameterDef } from '@open-mercato/shared/modules/reports/dsl'
import { Input } from '@open-mercato/ui/primitives/input'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'

/** Date-range tokens a fixed value can carry (`custom` needs explicit bounds, so it is not offered). */
export const PARAMETER_DATE_RANGE_TOKENS = [
  'today',
  'yesterday',
  'last_24h',
  'last_7_days',
  'last_30_days',
  'mtd',
  'last_month',
  'qtd',
  'last_quarter',
  'ytd',
  'last_year',
] as const

export function parameterLabel(param: ParameterDef, t: ReturnType<typeof useT>): string {
  return param.labelKey ? t(param.labelKey, param.key) : param.key
}

function optionValue(option: NonNullable<ParameterDef['options']>[number]): string | number {
  return typeof option === 'object' ? option.value : option
}

export type ParameterValueInputProps = {
  param: ParameterDef
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
  id?: string
}

/** A typed input for one report parameter, chosen by `param.kind`. */
export function ParameterValueInput({ param, value, onChange, disabled, id }: ParameterValueInputProps) {
  const t = useT()
  const ariaLabel = parameterLabel(param, t)

  switch (param.kind) {
    case 'boolean':
      return (
        <Switch
          id={id}
          aria-label={ariaLabel}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked === true)}
          disabled={disabled}
        />
      )
    case 'number':
      return (
        <Input
          id={id}
          aria-label={ariaLabel}
          type="number"
          value={typeof value === 'number' ? String(value) : ''}
          onChange={(event) => {
            const raw = event.target.value
            if (raw === '') return onChange(undefined)
            const parsed = Number(raw)
            onChange(Number.isFinite(parsed) ? parsed : undefined)
          }}
          disabled={disabled}
        />
      )
    case 'date':
      return (
        <Input
          id={id}
          aria-label={ariaLabel}
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value || undefined)}
          disabled={disabled}
        />
      )
    case 'date_range':
      return (
        <Select
          value={typeof value === 'string' ? value : undefined}
          onValueChange={(next) => onChange(next)}
          disabled={disabled}
        >
          <SelectTrigger id={id} aria-label={ariaLabel}>
            <SelectValue placeholder={t('reports.parameters.choose', 'Choose…')} />
          </SelectTrigger>
          <SelectContent>
            {PARAMETER_DATE_RANGE_TOKENS.map((token) => (
              <SelectItem key={token} value={token}>
                {t(`reports.detail.filters.dateRangeToken.${token}`, token)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    case 'enum': {
      const options = param.options ?? []
      return (
        <Select
          value={value === undefined || value === null ? undefined : String(value)}
          onValueChange={(next) => {
            const match = options.find((option) => String(optionValue(option)) === next)
            onChange(match === undefined ? next : optionValue(match))
          }}
          disabled={disabled}
        >
          <SelectTrigger id={id} aria-label={ariaLabel}>
            <SelectValue placeholder={t('reports.parameters.choose', 'Choose…')} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => {
              const raw = optionValue(option)
              const labelKey = typeof option === 'object' ? option.labelKey : undefined
              return (
                <SelectItem key={String(raw)} value={String(raw)}>
                  {labelKey ? t(labelKey, String(raw)) : String(raw)}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      )
    }
    default:
      return (
        <Input
          id={id}
          aria-label={ariaLabel}
          value={typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)}
          onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
          disabled={disabled}
        />
      )
  }
}

export default ParameterValueInput
