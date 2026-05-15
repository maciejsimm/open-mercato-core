export type Aggregation = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max'

export type MeasureExpr = {
  readonly field: string
  readonly aggregation: Aggregation
  readonly alias?: string
}

export type Row = Record<string, unknown>

export type GroupByInput = {
  readonly rows: readonly Row[]
  readonly groupBy: readonly string[]
  readonly measures: readonly MeasureExpr[]
}

export type SummaryInput = {
  readonly rows: readonly Row[]
  readonly measures: readonly MeasureExpr[]
}

export type PivotInput = {
  readonly rows: readonly Row[]
  readonly rowKeys: readonly string[]
  readonly colKeys: readonly string[]
  readonly value: MeasureExpr
}

export type PivotResult = {
  /** Distinct row-key combinations, in first-seen order. */
  readonly rowHeaders: ReadonlyArray<Row>
  /** Distinct column-key combinations, in first-seen order. */
  readonly colHeaders: ReadonlyArray<Row>
  /**
   * Cell values keyed by `cellKey(rowHash, colHash)`. Use `pivotCellKey` to
   * read a cell; missing combinations are absent (treat as `null`).
   */
  readonly cells: Readonly<Record<string, number | null>>
  /** Returns the row hash for a header (or any data row that carries the row keys). */
  readonly rowHash: (row: Row) => string
  /** Returns the column hash for a header (or any data row that carries the col keys). */
  readonly colHash: (row: Row) => string
}

/** Separator between row-hash and col-hash inside a pivot cell key. */
export const CELL_SEPARATOR = '__||__'

/** Build the cell key used by `PivotResult.cells`. */
export function pivotCellKey(rowHash: string, colHash: string): string {
  return `${rowHash}${CELL_SEPARATOR}${colHash}`
}

export function readFieldValue(row: Row, path: string): unknown {
  if (path.length === 0) return undefined
  if (!path.includes('.')) return row[path]
  const segments = path.split('.')
  let cursor: unknown = row
  for (const segment of segments) {
    if (cursor === null || cursor === undefined) return undefined
    if (typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

export function measureAlias(measure: MeasureExpr): string {
  if (measure.alias && measure.alias.trim().length > 0) return measure.alias.trim()
  const sanitized = measure.field.replace(/[^a-zA-Z0-9_]/g, '_')
  if (measure.aggregation === 'count' && (sanitized === '_' || sanitized === '')) return 'count'
  return `${measure.aggregation}_${sanitized}`
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'bigint') {
    const num = Number(value)
    return Number.isFinite(num) ? num : undefined
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) return undefined
    const num = Number(trimmed)
    return Number.isFinite(num) ? num : undefined
  }
  return undefined
}

function distinctKey(value: unknown): string {
  if (value === null) return 'null:'
  if (typeof value === 'object') return `obj:${JSON.stringify(value)}`
  if (typeof value === 'string') return `s:${value}`
  if (typeof value === 'number') return `n:${value}`
  if (typeof value === 'boolean') return `b:${value}`
  if (typeof value === 'bigint') return `i:${value.toString()}`
  return `x:${String(value)}`
}

type Accumulator = {
  add(value: unknown): void
  finalize(): number | null
}

function createAccumulator(aggregation: Aggregation): Accumulator {
  if (aggregation === 'count') {
    let count = 0
    return {
      add: () => { count += 1 },
      finalize: () => count,
    }
  }
  if (aggregation === 'count_distinct') {
    const set = new Set<string>()
    return {
      add: (value) => {
        if (value === undefined) return
        set.add(distinctKey(value))
      },
      finalize: () => set.size,
    }
  }
  if (aggregation === 'sum') {
    let sum = 0
    let hadValue = false
    return {
      add: (value) => {
        const num = toNumber(value)
        if (num === undefined) return
        sum += num
        hadValue = true
      },
      finalize: () => (hadValue ? sum : 0),
    }
  }
  if (aggregation === 'avg') {
    let sum = 0
    let count = 0
    return {
      add: (value) => {
        const num = toNumber(value)
        if (num === undefined) return
        sum += num
        count += 1
      },
      finalize: () => (count === 0 ? null : sum / count),
    }
  }
  if (aggregation === 'min') {
    let min: number | undefined = undefined
    return {
      add: (value) => {
        const num = toNumber(value)
        if (num === undefined) return
        if (min === undefined || num < min) min = num
      },
      finalize: () => (min === undefined ? null : min),
    }
  }
  let max: number | undefined = undefined
  return {
    add: (value) => {
      const num = toNumber(value)
      if (num === undefined) return
      if (max === undefined || num > max) max = num
    },
    finalize: () => (max === undefined ? null : max),
  }
}

/**
 * Stable hash for a row across `fields`. Uses JSON.stringify so the result
 * disambiguates `null` from the string `"null"` and from `undefined`
 * (rendered as `null` by JSON for arrays — we substitute a sentinel).
 */
export function hashKey(row: Row, fields: readonly string[]): string {
  if (fields.length === 0) return ''
  const tokens: unknown[] = []
  for (const field of fields) {
    const value = readFieldValue(row, field)
    if (value === undefined) tokens.push({ __undef: true })
    else tokens.push(value)
  }
  return JSON.stringify(tokens)
}

function pickKeyRow(row: Row, fields: readonly string[]): Row {
  const out: Row = {}
  for (const field of fields) out[field] = readFieldValue(row, field)
  return out
}

export function aggregateGroupBy(input: GroupByInput): Row[] {
  const { rows, groupBy, measures } = input
  if (groupBy.length === 0) {
    if (rows.length === 0 && measures.length === 0) return []
    return [aggregateSummary({ rows, measures })]
  }
  const groups = new Map<string, { keyRow: Row; accums: Accumulator[] }>()
  for (const row of rows) {
    const key = hashKey(row, groupBy)
    let group = groups.get(key)
    if (!group) {
      group = {
        keyRow: pickKeyRow(row, groupBy),
        accums: measures.map((m) => createAccumulator(m.aggregation)),
      }
      groups.set(key, group)
    }
    for (let i = 0; i < measures.length; i++) {
      const value = readFieldValue(row, measures[i].field)
      group.accums[i].add(value)
    }
  }
  const out: Row[] = []
  for (const group of groups.values()) {
    const result: Row = { ...group.keyRow }
    for (let i = 0; i < measures.length; i++) {
      result[measureAlias(measures[i])] = group.accums[i].finalize()
    }
    out.push(result)
  }
  return out
}

export function aggregateSummary(input: SummaryInput): Row {
  const { rows, measures } = input
  const accums = measures.map((m) => createAccumulator(m.aggregation))
  for (const row of rows) {
    for (let i = 0; i < measures.length; i++) {
      accums[i].add(readFieldValue(row, measures[i].field))
    }
  }
  const out: Row = {}
  for (let i = 0; i < measures.length; i++) {
    out[measureAlias(measures[i])] = accums[i].finalize()
  }
  return out
}

export function aggregatePivot(input: PivotInput): PivotResult {
  const { rows, rowKeys, colKeys, value } = input
  const rowHeaders = new Map<string, Row>()
  const colHeaders = new Map<string, Row>()
  const cellAccums = new Map<string, Accumulator>()
  for (const row of rows) {
    const rk = hashKey(row, rowKeys)
    const ck = hashKey(row, colKeys)
    if (!rowHeaders.has(rk)) rowHeaders.set(rk, pickKeyRow(row, rowKeys))
    if (!colHeaders.has(ck)) colHeaders.set(ck, pickKeyRow(row, colKeys))
    const cellKey = pivotCellKey(rk, ck)
    let acc = cellAccums.get(cellKey)
    if (!acc) {
      acc = createAccumulator(value.aggregation)
      cellAccums.set(cellKey, acc)
    }
    acc.add(readFieldValue(row, value.field))
  }
  const cells: Record<string, number | null> = {}
  for (const [key, acc] of cellAccums.entries()) {
    cells[key] = acc.finalize()
  }
  return {
    rowHeaders: Array.from(rowHeaders.values()),
    colHeaders: Array.from(colHeaders.values()),
    cells,
    rowHash: (row: Row) => hashKey(row, rowKeys),
    colHash: (row: Row) => hashKey(row, colKeys),
  }
}

/**
 * Flatten a `PivotResult` into wide-format rows keyed by a deterministic
 * column label, so the result can drop straight into a DataTable. Missing
 * cells become `null`.
 */
export function pivotToWideRows(
  pivot: PivotResult,
  options?: { colLabel?: (header: Row) => string },
): Row[] {
  const labelOf = options?.colLabel ?? defaultColLabel
  const wide: Row[] = []
  for (const rowHeader of pivot.rowHeaders) {
    const wideRow: Row = { ...rowHeader }
    const rk = pivot.rowHash(rowHeader)
    for (const colHeader of pivot.colHeaders) {
      const ck = pivot.colHash(colHeader)
      const cellKey = pivotCellKey(rk, ck)
      wideRow[labelOf(colHeader)] = pivot.cells[cellKey] ?? null
    }
    wide.push(wideRow)
  }
  return wide
}

function defaultColLabel(header: Row): string {
  const values = Object.values(header)
  if (values.length === 0) return '_'
  return values.map((v) => (v === null || v === undefined ? '∅' : String(v))).join('|')
}
