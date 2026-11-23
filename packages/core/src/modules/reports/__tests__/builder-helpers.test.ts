import {
  buildPreviewRequestBody,
  buildTypeSwitchMessage,
  filterFieldsByQuery,
  moveSortEntry,
  nextSortCandidate,
  previewParameters,
  sortCandidates,
  supportsLimit,
  supportsSort,
  type BuilderField,
  type BuilderParameter,
} from '../backend/reports/[id]/components/builder-helpers'
import { defaultDefinition, type BuilderDefinition, type BuilderFilter } from '../lib/definition-migrate'

const translate = (key: string, fallbackOrParams?: string | Record<string, string | number>, params?: Record<string, string | number>) => {
  const fallback = typeof fallbackOrParams === 'string' ? fallbackOrParams : key
  const vars = typeof fallbackOrParams === 'object' ? fallbackOrParams : params
  if (!vars) return fallback
  return fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
}

const LABELS: Record<string, string> = {
  'deals.fields.status': 'Status',
  'deals.fields.title': 'Title',
  'deals.fields.amount': 'Amount',
  'deals.status.open': 'Open',
  'deals.status.won': 'Won',
}

const t = (key: string, fallbackOrParams?: string | Record<string, string | number>, params?: Record<string, string | number>) =>
  LABELS[key] ?? translate(key, fallbackOrParams, params)

const FIELDS: BuilderField[] = [
  {
    key: 'status',
    labelKey: 'deals.fields.status',
    kind: 'enum',
    options: [{ value: 'open', labelKey: 'deals.status.open' }, { value: 'won', labelKey: 'deals.status.won' }, 'lost'],
  },
  { key: 'title', labelKey: 'deals.fields.title', kind: 'text' },
  { key: 'amount', labelKey: 'deals.fields.amount', kind: 'money' },
  { key: 'payload', labelKey: 'deals.fields.payload', kind: 'json', sortable: false },
]
const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]))

const PARAMETER_FILTER: BuilderFilter = { kind: 'parameter', field: 'status', op: 'eq', parameter: 'status' }

describe('previewParameters', () => {
  const params: BuilderParameter[] = [
    { key: 'status', labelKey: 'deals.params.status', kind: 'string', defaultValue: 'open', required: true },
    { key: 'draft', labelKey: 'x', kind: 'string' },
  ]

  it('keeps only referenced declarations without labels', () => {
    expect(previewParameters([PARAMETER_FILTER], params)).toEqual([
      { key: 'status', kind: 'string', defaultValue: 'open', required: true },
    ])
  })

  it('returns nothing when no filter references a parameter', () => {
    expect(previewParameters([{ kind: 'literal', field: 'title', op: 'eq', value: 'x' }], params)).toEqual([])
  })
})

describe('buildPreviewRequestBody', () => {
  const definition: BuilderDefinition = { ...defaultDefinition('flat_list'), fields: ['title'], filters: [PARAMETER_FILTER] } as BuilderDefinition
  const base: BuilderParameter[] = [{ key: 'status', kind: 'string', defaultValue: 'open' }]

  it('is unchanged when a label or an unreferenced key is edited', () => {
    const before = buildPreviewRequestBody('deals', definition, base)
    const relabelled = buildPreviewRequestBody('deals', definition, [{ ...base[0], labelKey: 'deals.params.st' }])
    const typing = buildPreviewRequestBody('deals', definition, [...base, { key: 'regi', kind: 'string' }])
    expect(relabelled).toBe(before)
    expect(typing).toBe(before)
  })

  it('changes when a referenced default value or the definition changes', () => {
    const before = buildPreviewRequestBody('deals', definition, base)
    expect(buildPreviewRequestBody('deals', definition, [{ ...base[0], defaultValue: 'won' }])).not.toBe(before)
    const nextDefinition = { ...definition, fields: ['title', 'amount'] } as BuilderDefinition
    expect(buildPreviewRequestBody('deals', nextDefinition, base)).not.toBe(before)
  })
})

describe('filterFieldsByQuery', () => {
  const plain = (key: string, fallback: string) => LABELS[key] ?? fallback

  it('matches translated labels and keys, case-insensitively', () => {
    expect(filterFieldsByQuery(FIELDS, 'STAT', plain).map((f) => f.key)).toEqual(['status'])
    expect(filterFieldsByQuery(FIELDS, 'amo', plain).map((f) => f.key)).toEqual(['amount'])
    expect(filterFieldsByQuery(FIELDS, 'payl', plain).map((f) => f.key)).toEqual(['payload'])
  })

  it('returns every field for a blank query', () => {
    expect(filterFieldsByQuery(FIELDS, '  ', plain)).toHaveLength(FIELDS.length)
  })
})

describe('sortCandidates', () => {
  it('offers sortable dataset fields for flat lists', () => {
    const def = defaultDefinition('flat_list')
    expect(sortCandidates(def, FIELDS, FIELD_BY_KEY, t).map((c) => c.key)).toEqual(['status', 'title', 'amount'])
  })

  it('offers group keys (with enum option order) and measure aliases for grouped reports', () => {
    const def: BuilderDefinition = {
      ...defaultDefinition('grouped'),
      groupBy: ['status'],
      measures: [{ field: 'amount', aggregation: 'sum' }],
    } as BuilderDefinition
    const candidates = sortCandidates(def, FIELDS, FIELD_BY_KEY, t)
    expect(candidates.map((c) => c.key)).toEqual(['status', 'sum_amount'])
    expect(candidates[0].enumOrder).toEqual(['Open', 'Won', 'lost'])
    expect(candidates[1].isMeasure).toBe(true)
  })

  it('offers nothing for pivot, chart and summary', () => {
    expect(sortCandidates(defaultDefinition('pivot'), FIELDS, FIELD_BY_KEY, t)).toEqual([])
    expect(sortCandidates(defaultDefinition('chart'), FIELDS, FIELD_BY_KEY, t)).toEqual([])
    expect(sortCandidates(defaultDefinition('summary'), FIELDS, FIELD_BY_KEY, t)).toEqual([])
  })
})

describe('sort/limit support', () => {
  it('follows the definition schemas', () => {
    expect(supportsSort(defaultDefinition('flat_list'))).toBe(true)
    expect(supportsSort(defaultDefinition('grouped'))).toBe(true)
    expect(supportsSort(defaultDefinition('chart'))).toBe(false)
    expect(supportsLimit(defaultDefinition('chart'))).toBe(true)
    expect(supportsLimit(defaultDefinition('pivot'))).toBe(false)
    expect(supportsLimit(defaultDefinition('summary'))).toBe(false)
  })
})

describe('moveSortEntry / nextSortCandidate', () => {
  const sort = [{ field: 'a', dir: 'asc' as const }, { field: 'b', dir: 'desc' as const }, { field: 'c', dir: 'asc' as const }]

  it('moves entries and ignores out-of-range moves', () => {
    expect(moveSortEntry(sort, 2, -1).map((s) => s.field)).toEqual(['a', 'c', 'b'])
    expect(moveSortEntry(sort, 0, 1).map((s) => s.field)).toEqual(['b', 'a', 'c'])
    expect(moveSortEntry(sort, 0, -1)).toEqual(sort)
    expect(moveSortEntry(sort, 2, 1)).toEqual(sort)
  })

  it('picks the first unused candidate', () => {
    const candidates = [{ key: 'a', label: 'A' }, { key: 'd', label: 'D' }]
    expect(nextSortCandidate(sort, candidates)?.key).toBe('d')
    expect(nextSortCandidate([...sort, { field: 'd', dir: 'asc' }], candidates)).toBeUndefined()
  })
})

describe('buildTypeSwitchMessage', () => {
  it('lists dropped items per slot with the restore hint', () => {
    const message = buildTypeSwitchMessage(
      'pivot',
      [
        { slot: 'fields', field: 'title' },
        { slot: 'sort', field: 'status' },
        { slot: 'limit', value: 50 },
      ],
      FIELD_BY_KEY,
      t,
    )
    expect(message).toBe(
      'pivot cannot keep everything. Not carried over: Fields: Title; Sort: Status; Limit: 50. Switch back without editing to restore the previous setup.',
    )
  })
})
