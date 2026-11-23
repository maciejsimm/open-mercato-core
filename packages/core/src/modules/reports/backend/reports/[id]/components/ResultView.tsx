"use client"

import * as React from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useOptionalLocale } from '@open-mercato/shared/lib/i18n/context'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  measureAlias,
  type DatasetFieldKind,
  type FieldFormat,
  type MeasureExpr,
  type ReportColumnDescriptor,
} from '@open-mercato/shared/modules/reports/dsl'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { Button } from '@open-mercato/ui/primitives/button'
import { cn } from '@open-mercato/shared/lib/utils'
import { NULL_DISPLAY, findColumn, formatReportValue } from '../../../../lib/format'
import type { BuilderDefinition } from '../../../../lib/definition-migrate'

type EnumOption = string | number | { value: string | number; labelKey?: string }

export type ResultField = {
  key: string
  labelKey: string
  kind: string
  options?: EnumOption[]
}

const DESCRIPTOR_KINDS: ReadonlySet<string> = new Set<DatasetFieldKind>([
  'id', 'text', 'integer', 'float', 'money', 'boolean', 'date', 'datetime', 'enum', 'fk', 'json',
])

function isDescriptorKind(kind: string): kind is Exclude<DatasetFieldKind, 'custom_field'> {
  return DESCRIPTOR_KINDS.has(kind)
}

/** Client-side descriptor for a dataset field, used for pivot column header values. */
export function describeResultField(field: ResultField | undefined, key: string): ReportColumnDescriptor {
  if (!field) return { key, kind: 'text' }
  return {
    key,
    labelKey: field.labelKey,
    kind: isDescriptorKind(field.kind) ? field.kind : 'text',
    ...(field.options ? { options: field.options } : {}),
  }
}

export function definitionMeasureList(definition: BuilderDefinition): MeasureExpr[] {
  switch (definition.type) {
    case 'grouped':
    case 'summary':
    case 'chart':
      return definition.measures
    case 'pivot':
      return definition.value && definition.value.field ? [definition.value] : []
    default:
      return []
  }
}

export function measureLabel(measure: MeasureExpr, fieldByKey: ReadonlyMap<string, ResultField>, t: TranslateFn): string {
  if (measure.alias && measure.alias.trim()) return measure.alias.trim()
  const field = fieldByKey.get(measure.field)
  const fieldLabel = field ? t(field.labelKey, field.key) : measure.field
  return t('reports.detail.result.measureLabel', '{aggregation} · {field}', {
    aggregation: t(`reports.detail.aggregation.${measure.aggregation}`, measure.aggregation),
    field: fieldLabel,
  })
}

/** Legend / tooltip labels for chart series, keyed by measure alias. */
export function buildSeriesLabels(
  definition: BuilderDefinition,
  fieldByKey: ReadonlyMap<string, ResultField>,
  t: TranslateFn,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const measure of definitionMeasureList(definition)) out[measureAlias(measure)] = measureLabel(measure, fieldByKey, t)
  return out
}

export type ValueFormatter = (value: unknown, key: string, row?: Record<string, unknown>) => string

export function useReportValueFormatter(
  columns: readonly ReportColumnDescriptor[] | undefined,
  definition: BuilderDefinition,
  t: TranslateFn,
): ValueFormatter {
  const locale = useOptionalLocale() ?? 'en'
  const overrides = definition.columnFormats
  return React.useCallback(
    (value, key, row) =>
      formatReportValue(value, findColumn(columns, key), {
        locale,
        translate: (labelKey, fallback) => t(labelKey, fallback),
        row,
        override: overrides?.[key],
      }),
    [columns, locale, overrides, t],
  )
}

function columnHeaderLabel(
  key: string,
  definition: BuilderDefinition,
  fieldByKey: ReadonlyMap<string, ResultField>,
  locale: string,
  t: TranslateFn,
): string {
  const measure = definitionMeasureList(definition).find((m) => measureAlias(m) === key)
  if (measure) return measureLabel(measure, fieldByKey, t)
  if (definition.type === 'pivot' && !definition.rows.includes(key)) {
    if (definition.cols.length === 0 && definition.value) return measureLabel(definition.value, fieldByKey, t)
    const parts = key.split('|')
    return parts
      .map((part, idx) => {
        const colKey = definition.cols[idx]
        if (part === '∅') return NULL_DISPLAY
        if (!colKey) return part
        return formatReportValue(part, describeResultField(fieldByKey.get(colKey), colKey), {
          locale,
          translate: (labelKey, fallback) => t(labelKey, fallback),
        })
      })
      .join(' · ')
  }
  const field = fieldByKey.get(key)
  if (field) return t(field.labelKey, field.key)
  return key
}

const NUMERIC_FORMAT_KINDS = new Set(['integer', 'float', 'money', 'pivot_cell'])
const DATE_FORMAT_KINDS = new Set(['date', 'datetime'])

function formatEditorKind(column: ReportColumnDescriptor | undefined): 'numeric' | 'date' | null {
  if (!column) return null
  if (NUMERIC_FORMAT_KINDS.has(column.kind)) return 'numeric'
  if (DATE_FORMAT_KINDS.has(column.kind)) return 'date'
  return null
}

/** Drop empty keys so an all-default override removes the entry entirely. */
export function cleanFieldFormat(format: FieldFormat): FieldFormat | undefined {
  const out: FieldFormat = {}
  if (typeof format.precision === 'number') out.precision = format.precision
  if (format.dateStyle) out.dateStyle = format.dateStyle
  if (format.percent) out.percent = true
  if (format.compact) out.compact = true
  return Object.keys(out).length > 0 ? out : undefined
}

const PRECISION_OPTIONS = [0, 1, 2, 3, 4, 5, 6]
const DATE_STYLES: Array<NonNullable<FieldFormat['dateStyle']>> = ['short', 'medium', 'long']

type ColumnFormatEditorProps = {
  label: string
  kind: 'numeric' | 'date'
  value: FieldFormat | undefined
  onChange: (next: FieldFormat | undefined) => void
  t: TranslateFn
}

function ColumnFormatEditor({ label, kind, value, onChange, t }: ColumnFormatEditorProps) {
  const current = value ?? {}
  const update = (patch: Partial<FieldFormat>) => onChange(cleanFieldFormat({ ...current, ...patch }))
  const isCustomized = !!value && Object.keys(value).length > 0
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'rounded-sm p-0.5 hover:bg-muted',
            isCustomized ? 'text-primary' : 'text-muted-foreground',
          )}
          aria-label={t('reports.detail.format.edit', 'Format {column}', { column: label })}
        >
          <SlidersHorizontal className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3 p-3" align="start">
        <p className="text-sm font-medium text-foreground">
          {t('reports.detail.format.title', 'Format: {column}', { column: label })}
        </p>
        {kind === 'numeric' ? (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.format.precision', 'Decimal places')}</span>
              <select
                value={typeof current.precision === 'number' ? String(current.precision) : ''}
                onChange={(e) => update({ precision: e.target.value === '' ? undefined : Number(e.target.value) })}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">{t('reports.detail.format.default', 'Default')}</option>
                {PRECISION_OPTIONS.map((p) => (
                  <option key={p} value={String(p)}>{p}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(current.percent)}
                onChange={(e) => update({ percent: e.target.checked || undefined })}
              />
              {t('reports.detail.format.percent', 'Show as percent')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(current.compact)}
                onChange={(e) => update({ compact: e.target.checked || undefined })}
              />
              {t('reports.detail.format.compact', 'Compact (1.2K, 3.4M)')}
            </label>
          </>
        ) : (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t('reports.detail.format.dateStyle', 'Date style')}</span>
            <select
              value={current.dateStyle ?? ''}
              onChange={(e) => {
                const next = DATE_STYLES.find((style) => style === e.target.value)
                update({ dateStyle: next })
              }}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{t('reports.detail.format.default', 'Default')}</option>
              {DATE_STYLES.map((style) => (
                <option key={style} value={style}>{t(`reports.detail.format.dateStyles.${style}`, style)}</option>
              ))}
            </select>
          </label>
        )}
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="outline" disabled={!isCustomized} onClick={() => onChange(undefined)}>
            {t('reports.detail.format.reset', 'Reset')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export type ResultTableProps = {
  rows: Array<Record<string, unknown>>
  columnKeys: string[]
  columns?: ReportColumnDescriptor[]
  mixedCurrencyColumns?: string[]
  definition: BuilderDefinition
  fieldByKey: ReadonlyMap<string, ResultField>
  canEditFormats: boolean
  onColumnFormatChange?: (key: string, format: FieldFormat | undefined) => void
  t: TranslateFn
}

export function ResultTable({
  rows,
  columnKeys,
  columns,
  mixedCurrencyColumns,
  definition,
  fieldByKey,
  canEditFormats,
  onColumnFormatChange,
  t,
}: ResultTableProps) {
  const locale = useOptionalLocale() ?? 'en'
  const format = useReportValueFormatter(columns, definition, t)
  const mixed = React.useMemo(() => new Set(mixedCurrencyColumns ?? []), [mixedCurrencyColumns])
  const headers = React.useMemo(
    () => columnKeys.map((key) => ({
      key,
      label: columnHeaderLabel(key, definition, fieldByKey, locale, t),
      column: findColumn(columns, key),
    })),
    [columnKeys, columns, definition, fieldByKey, locale, t],
  )
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {headers.map(({ key, label, column }) => {
              const editorKind = formatEditorKind(column)
              const numeric = column ? NUMERIC_FORMAT_KINDS.has(column.kind) : false
              return (
                <th
                  key={key}
                  className={cn(
                    'px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground',
                    numeric ? 'text-right' : 'text-left',
                  )}
                  title={key}
                >
                  <span className={cn('inline-flex items-center gap-1', numeric ? 'flex-row-reverse' : '')}>
                    <span>{label}</span>
                    {canEditFormats && editorKind && onColumnFormatChange ? (
                      <ColumnFormatEditor
                        label={label}
                        kind={editorKind}
                        value={definition.columnFormats?.[key]}
                        onChange={(next) => onColumnFormatChange(key, next)}
                        t={t}
                      />
                    ) : null}
                  </span>
                  {mixed.has(key) ? (
                    <span className="mt-0.5 block text-xs font-normal normal-case tracking-normal text-status-warning-text">
                      {t('reports.format.mixedCurrency', 'Mixed currencies — not summed across currencies')}
                    </span>
                  ) : null}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} className="border-b border-border/60 last:border-b-0">
              {headers.map(({ key, column }) => {
                const numeric = column ? NUMERIC_FORMAT_KINDS.has(column.kind) : false
                return (
                  <td key={key} className={cn('px-3 py-2 align-top', numeric ? 'text-right tabular-nums' : '')}>
                    {format(row[key], key, row)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
