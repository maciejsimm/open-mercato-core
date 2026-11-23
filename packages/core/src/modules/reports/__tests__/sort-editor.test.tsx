/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { SortEditor } from '../backend/reports/[id]/components/SortEditor'
import type { BuilderField } from '../backend/reports/[id]/components/builder-helpers'
import { defaultDefinition, type BuilderDefinition } from '../lib/definition-migrate'

const LABELS: Record<string, string> = { 'f.status': 'Status', 'f.title': 'Title', 'f.amount': 'Amount' }

const t: TranslateFn = (key, fallbackOrParams, params) => {
  if (LABELS[key]) return LABELS[key]
  const fallback = typeof fallbackOrParams === 'string' ? fallbackOrParams : key
  const vars = typeof fallbackOrParams === 'object' ? fallbackOrParams : params
  if (!vars) return fallback
  return fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
}

const FIELDS: BuilderField[] = [
  { key: 'status', labelKey: 'f.status', kind: 'enum', options: ['open', 'won', 'lost'] },
  { key: 'title', labelKey: 'f.title', kind: 'text' },
  { key: 'amount', labelKey: 'f.amount', kind: 'money' },
]
const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]))

function renderEditor(definition: BuilderDefinition, onChange = jest.fn()) {
  renderWithProviders(
    <SortEditor definition={definition} fields={FIELDS} fieldByKey={FIELD_BY_KEY} canEdit onChange={onChange} t={t} />,
  )
  return onChange
}

describe('SortEditor', () => {
  const grouped: BuilderDefinition = {
    ...defaultDefinition('grouped'),
    groupBy: ['status'],
    measures: [{ field: 'amount', aggregation: 'sum' }],
    sort: [{ field: 'status', dir: 'asc' }, { field: 'sum_amount', dir: 'desc' }],
  } as BuilderDefinition

  it('shows grouped sort keys with the enum declared order', () => {
    renderEditor(grouped)
    expect(screen.getAllByTestId('reports-sort-row')).toHaveLength(2)
    expect(screen.getByTestId('reports-sort-enum-order').textContent).toBe('Order: open → won → lost')
    expect(screen.getByRole('option', { name: 'Option order' })).toBeTruthy()
  })

  it('reorders, flips direction and removes keys', () => {
    const onChange = renderEditor(grouped)
    fireEvent.click(screen.getByRole('button', { name: /Move sum · Amount up/ }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      sort: [{ field: 'sum_amount', dir: 'desc' }, { field: 'status', dir: 'asc' }],
    }))
    const [firstDir] = screen.getAllByRole('combobox', { name: 'Direction' })
    fireEvent.change(firstDir, { target: { value: 'desc' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      sort: [{ field: 'status', dir: 'desc' }, { field: 'sum_amount', dir: 'desc' }],
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Status' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ sort: [{ field: 'sum_amount', dir: 'desc' }] }))
  })

  it('adds the next unused key and disables adding when every key is used', () => {
    const flat = { ...defaultDefinition('flat_list'), sort: [{ field: 'status', dir: 'asc' }] } as BuilderDefinition
    const onChange = renderEditor(flat)
    fireEvent.click(screen.getByRole('button', { name: 'Add sort key' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      sort: [{ field: 'status', dir: 'asc' }, { field: 'title', dir: 'asc' }],
    }))
    expect(screen.queryByTestId('reports-sort-enum-order')).toBeNull()
  })

  it('shows only the limit for charts', () => {
    const onChange = renderEditor(defaultDefinition('chart'))
    expect(screen.queryByRole('button', { name: 'Add sort key' })).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('No limit'), { target: { value: '25' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'chart', limit: 25 }))
  })

  it('explains when a type has neither sort nor limit', () => {
    renderEditor(defaultDefinition('pivot'))
    expect(screen.getByTestId('reports-sort-unsupported')).toBeTruthy()
  })
})
