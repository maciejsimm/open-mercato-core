"use client"

import * as React from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { Sort } from '@open-mercato/shared/modules/reports/dsl'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import type { BuilderDefinition } from '../../../../lib/definition-migrate'
import {
  moveSortEntry,
  nextSortCandidate,
  sortCandidates,
  supportsLimit,
  supportsSort,
  type BuilderField,
  type SortCandidate,
} from './builder-helpers'

const MAX_LIMIT = 100_000
const SELECT_CLASS = 'h-8 w-full rounded-md border border-input bg-background px-2 text-sm'

export type SortEditorProps = {
  definition: BuilderDefinition
  fields: readonly BuilderField[]
  fieldByKey: ReadonlyMap<string, BuilderField>
  canEdit: boolean
  onChange: (next: BuilderDefinition) => void
  t: TranslateFn
}

/**
 * Sorting + limit editor for the Filters & Sorting tab. Flat lists sort by
 * sortable dataset fields, grouped reports by group keys or measure aliases
 * (multiple keys, reorderable). Charts expose only the row limit — their
 * schema has no sort. Enum group keys explain that ascending follows the
 * declared option order, which is how the executor sorts them.
 */
export function SortEditor({ definition, fields, fieldByKey, canEdit, onChange, t }: SortEditorProps) {
  const candidates = React.useMemo(
    () => sortCandidates(definition, fields, fieldByKey, t),
    [definition, fieldByKey, fields, t],
  )
  const candidateByKey = React.useMemo(() => new Map(candidates.map((c) => [c.key, c])), [candidates])

  if (!supportsSort(definition) && !supportsLimit(definition)) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="reports-sort-unsupported">
        {t('reports.detail.sort.unsupported', 'This report type has no sorting or row limit.')}
      </p>
    )
  }

  const sort: Sort[] = supportsSort(definition) ? definition.sort : []
  const setSort = (next: Sort[]) => {
    if (definition.type === 'flat_list' || definition.type === 'grouped') onChange({ ...definition, sort: next })
  }
  const limit = definition.type === 'flat_list' || definition.type === 'grouped' || definition.type === 'chart'
    ? definition.limit
    : undefined
  const setLimit = (next: number | undefined) => {
    if (definition.type === 'flat_list' || definition.type === 'grouped' || definition.type === 'chart') {
      onChange({ ...definition, limit: next })
    }
  }
  const addCandidate = nextSortCandidate(sort, candidates)

  return (
    <section className="space-y-3" data-testid="reports-sort-editor">
      {supportsSort(definition) ? (
        <div className="space-y-2">
          <div>
            <h3 className="text-sm font-medium text-foreground">{t('reports.detail.sort.title', 'Sorting')}</h3>
            <p className="text-xs text-muted-foreground">
              {definition.type === 'grouped'
                ? t('reports.detail.sort.groupedHint', 'Sort the grouped rows by a group key or a measure. The first key wins; later keys break ties.')
                : t('reports.detail.sort.flatHint', 'Sort the rows by one or more fields. The first key wins; later keys break ties.')}
            </p>
          </div>
          {sort.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {definition.type === 'grouped'
                ? t('reports.detail.sort.emptyGrouped', 'No sorting — rows follow the first group key (enum keys in their declared order).')
                : t('reports.detail.sort.empty', 'No sorting — the dataset default order applies.')}
            </p>
          ) : (
            <ol className="space-y-1.5">
              {sort.map((entry, index) => (
                <SortRow
                  key={`${entry.field}-${index}`}
                  entry={entry}
                  index={index}
                  count={sort.length}
                  candidate={candidateByKey.get(entry.field)}
                  options={candidates.filter((c) => c.key === entry.field || !sort.some((other) => other.field === c.key))}
                  showEnumOrder={definition.type === 'grouped'}
                  canEdit={canEdit}
                  onChange={(next) => setSort(sort.map((item, i) => (i === index ? next : item)))}
                  onMove={(delta) => setSort(moveSortEntry(sort, index, delta))}
                  onRemove={() => setSort(sort.filter((_, i) => i !== index))}
                  t={t}
                />
              ))}
            </ol>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canEdit || !addCandidate}
            onClick={() => { if (addCandidate) setSort([...sort, { field: addCandidate.key, dir: 'asc' }]) }}
          >
            <Plus className="size-3.5" aria-hidden />
            <span>{t('reports.detail.sort.add', 'Add sort key')}</span>
          </Button>
          {candidates.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {definition.type === 'grouped'
                ? t('reports.detail.sort.noCandidatesGrouped', 'Add a group key or a measure first.')
                : t('reports.detail.sort.noCandidates', 'This dataset has no sortable fields.')}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('reports.detail.sort.chartHint', 'Charts keep the order of their X axis; use the limit to cap how many points are plotted.')}
        </p>
      )}
      {supportsLimit(definition) ? (
        <label className="block max-w-48 space-y-1">
          <span className="text-xs font-medium text-foreground">{t('reports.detail.zones.limit', 'Limit')}</span>
          <Input
            type="number"
            min={1}
            max={MAX_LIMIT}
            size="sm"
            value={limit ?? ''}
            onChange={(e) => {
              const raw = e.target.value
              if (!raw.trim()) return setLimit(undefined)
              const parsed = Number(raw)
              if (!Number.isFinite(parsed) || parsed <= 0) return
              setLimit(Math.min(Math.floor(parsed), MAX_LIMIT))
            }}
            disabled={!canEdit}
            placeholder={t('reports.detail.fields.limitPlaceholder', 'No limit')}
          />
        </label>
      ) : null}
    </section>
  )
}

type SortRowProps = {
  entry: Sort
  index: number
  count: number
  candidate: SortCandidate | undefined
  options: SortCandidate[]
  showEnumOrder: boolean
  canEdit: boolean
  onChange: (next: Sort) => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
  t: TranslateFn
}

function SortRow({ entry, index, count, candidate, options, showEnumOrder, canEdit, onChange, onMove, onRemove, t }: SortRowProps) {
  const label = candidate?.label ?? entry.field
  const enumOrder = showEnumOrder ? candidate?.enumOrder : undefined
  const ascLabel = enumOrder
    ? t('reports.detail.sort.ascEnum', 'Option order')
    : t('reports.detail.fields.sortAsc', 'Ascending')
  const descLabel = enumOrder
    ? t('reports.detail.sort.descEnum', 'Reverse option order')
    : t('reports.detail.fields.sortDesc', 'Descending')
  const orderedValues = enumOrder ? (entry.dir === 'desc' ? [...enumOrder].reverse() : enumOrder) : null
  return (
    <li className="rounded-md border border-border bg-background px-2 py-1.5" data-testid="reports-sort-row">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
        <select
          aria-label={t('reports.detail.sort.field', 'Sort by')}
          value={entry.field}
          onChange={(e) => onChange({ ...entry, field: e.target.value })}
          disabled={!canEdit}
          className={`${SELECT_CLASS} min-w-40 flex-1`}
        >
          {candidate ? null : <option value={entry.field}>{entry.field}</option>}
          {options.map((option) => (
            <option key={option.key} value={option.key}>{option.label}</option>
          ))}
        </select>
        <select
          aria-label={t('reports.detail.fields.sortDir', 'Direction')}
          value={entry.dir}
          onChange={(e) => onChange({ ...entry, dir: e.target.value === 'desc' ? 'desc' : 'asc' })}
          disabled={!canEdit}
          className={`${SELECT_CLASS} w-auto min-w-32`}
        >
          <option value="asc">{ascLabel}</option>
          <option value="desc">{descLabel}</option>
        </select>
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            disabled={!canEdit || index === 0}
            onClick={() => onMove(-1)}
            aria-label={t('reports.detail.sort.moveUp', 'Move {name} up', { name: label })}
          >
            <ArrowUp className="size-3.5" aria-hidden />
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            disabled={!canEdit || index === count - 1}
            onClick={() => onMove(1)}
            aria-label={t('reports.detail.sort.moveDown', 'Move {name} down', { name: label })}
          >
            <ArrowDown className="size-3.5" aria-hidden />
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            disabled={!canEdit}
            onClick={onRemove}
            aria-label={t('reports.detail.chip.remove', 'Remove {name}', { name: label })}
          >
            <X className="size-3.5" aria-hidden />
          </IconButton>
        </div>
      </div>
      {orderedValues ? (
        <p className="mt-1 pl-7 text-xs text-muted-foreground" data-testid="reports-sort-enum-order">
          {t('reports.detail.sort.enumOrder', 'Order: {values}', { values: orderedValues.join(' → ') })}
        </p>
      ) : null}
    </li>
  )
}

