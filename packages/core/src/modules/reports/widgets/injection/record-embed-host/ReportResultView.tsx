"use client"

import * as React from 'react'
import { useOptionalLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import type { ReportColumnDescriptor, ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import { findColumn, formatReportValue } from '../../../lib/format'
import { ReportChart } from '../../ReportChart'

export type ReportRunMeta = {
  fields?: string[]
  columns?: ReportColumnDescriptor[]
  mixedCurrencyColumns?: string[]
}

export function readRunMeta(raw: unknown): ReportRunMeta {
  if (!raw || typeof raw !== 'object') return {}
  const obj = raw as Record<string, unknown>
  return {
    fields: Array.isArray(obj.fields) ? obj.fields.filter((f): f is string => typeof f === 'string') : undefined,
    columns: Array.isArray(obj.columns) ? (obj.columns as ReportColumnDescriptor[]) : undefined,
    mixedCurrencyColumns: Array.isArray(obj.mixedCurrencyColumns)
      ? obj.mixedCurrencyColumns.filter((f): f is string => typeof f === 'string')
      : undefined,
  }
}

export type ReportResultViewProps = {
  rows: Record<string, unknown>[]
  meta?: ReportRunMeta
  /** Report definition; selects chart / KPI rendering and supplies column format overrides. */
  definition?: ReportDefinition | null
  /** Force a table even for chart / summary reports (dashboard tile `inline` mode with a table preference). */
  preferTable?: boolean
  maxRows?: number
}

function resolveColumnKeys(rows: Record<string, unknown>[], meta: ReportRunMeta | undefined): string[] {
  if (meta?.fields && meta.fields.length > 0) return meta.fields
  if (meta?.columns && meta.columns.length > 0) return meta.columns.map((column) => column.key)
  return rows[0] ? Object.keys(rows[0]) : []
}

/**
 * Read-only rendering of a report run (`rows` + `meta.columns`). Every value
 * goes through `formatReportValue` with the viewer's locale.
 */
export function ReportResultView({ rows, meta, definition, preferTable, maxRows = 25 }: ReportResultViewProps) {
  const t = useT()
  const locale = useOptionalLocale() ?? 'en'
  const timeZone = React.useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const columnFormats = definition?.columnFormats
  const mixed = React.useMemo(() => new Set(meta?.mixedCurrencyColumns ?? []), [meta?.mixedCurrencyColumns])

  const format = React.useCallback(
    (value: unknown, key: string, row?: Record<string, unknown>) =>
      formatReportValue(value, findColumn(meta?.columns, key), {
        locale,
        timeZone,
        translate: (labelKey, fallback) => t(labelKey, fallback),
        row,
        override: columnFormats?.[key],
      }),
    [columnFormats, locale, meta?.columns, t, timeZone],
  )

  const label = React.useCallback(
    (key: string) => {
      const column = findColumn(meta?.columns, key)
      return column?.labelKey ? t(column.labelKey, key) : key
    },
    [meta?.columns, t],
  )

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('reports.embed.empty', 'No data.')}</p>
  }

  if (!preferTable && definition?.type === 'chart' && definition.chart) {
    return <ReportChart spec={definition.chart} rows={rows} columns={meta?.columns} columnFormats={columnFormats} />
  }

  const keys = resolveColumnKeys(rows, meta)

  if (!preferTable && definition?.type === 'summary' && rows.length === 1) {
    const row = rows[0]
    return (
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {keys.map((key) => (
          <div key={key} className="rounded-md border border-border bg-background px-3 py-2">
            <dt className="text-xs text-muted-foreground">{label(key)}</dt>
            <dd className="text-2xl font-semibold text-foreground">{format(row[key], key, row)}</dd>
            {mixed.has(key) ? (
              <p className="text-xs text-status-warning-text">{t('reports.format.mixedCurrency', 'Mixed currencies')}</p>
            ) : null}
          </div>
        ))}
      </dl>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {keys.map((key) => (
              <th key={key} className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                <span>{label(key)}</span>
                {mixed.has(key) ? (
                  <span className="ml-1 text-status-warning-text" title={t('reports.format.mixedCurrency', 'Mixed currencies')}>*</span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, maxRows).map((row, idx) => (
            <tr key={idx} className="border-b border-border/60 last:border-b-0">
              {keys.map((key) => (
                <td key={key} className="px-3 py-1.5 align-top">{format(row[key], key, row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default ReportResultView
