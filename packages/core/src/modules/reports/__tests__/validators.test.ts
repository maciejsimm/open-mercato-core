import {
  dashboardCreateSchema,
  dashboardLayoutSchema,
  dashboardUpdateSchema,
  folderCreateSchema,
  folderShareCreateSchema,
  reportCreateSchema,
  reportDefinitionSchema,
  reportRunSchema,
  reportUpdateSchema,
} from '../data/validators'

describe('folder validators', () => {
  test('folderCreateSchema accepts a private folder with owner inferred elsewhere', () => {
    expect(folderCreateSchema.safeParse({ kind: 'private', name: 'My drafts' }).success).toBe(true)
  })

  test('folderCreateSchema rejects empty names', () => {
    expect(folderCreateSchema.safeParse({ kind: 'private', name: '' }).success).toBe(false)
  })

  test('folderShareCreateSchema requires uuid principal id', () => {
    expect(
      folderShareCreateSchema.safeParse({
        folderId: '11111111-1111-4111-8111-111111111111',
        principalType: 'role',
        principalId: 'not-a-uuid',
        permission: 'view',
      }).success,
    ).toBe(false)
  })

  test('folderShareCreateSchema accepts valid input', () => {
    expect(
      folderShareCreateSchema.safeParse({
        folderId: '11111111-1111-4111-8111-111111111111',
        principalType: 'role',
        principalId: '22222222-2222-4222-8222-222222222222',
        permission: 'edit',
      }).success,
    ).toBe(true)
  })
})

describe('reportDefinitionSchema (flat_list)', () => {
  test('accepts a minimal flat_list with default filters/sort', () => {
    const parsed = reportDefinitionSchema.safeParse({
      type: 'flat_list',
      fields: ['id', 'name'],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success && parsed.data.type === 'flat_list') {
      expect(parsed.data.filters).toEqual([])
      expect(parsed.data.sort).toEqual([])
    }
  })

  test('rejects flat_list with empty fields', () => {
    expect(
      reportDefinitionSchema.safeParse({ type: 'flat_list', fields: [] }).success,
    ).toBe(false)
  })

  test('accepts nested filter groups', () => {
    const parsed = reportDefinitionSchema.safeParse({
      type: 'flat_list',
      fields: ['id'],
      filters: [
        {
          kind: 'group',
          op: 'and',
          children: [
            { kind: 'literal', field: 'status', op: 'eq', value: 'paid' },
            {
              kind: 'group',
              op: 'or',
              children: [
                { kind: 'parameter', field: 'priority', op: 'eq', parameter: 'pri' },
                { kind: 'date_range', field: 'created_at', token: 'last_30_days' },
              ],
            },
          ],
        },
      ],
    })
    expect(parsed.success).toBe(true)
  })

  test('rejects unknown filter op', () => {
    expect(
      reportDefinitionSchema.safeParse({
        type: 'flat_list',
        fields: ['id'],
        filters: [{ kind: 'literal', field: 'x', op: 'matches', value: 'y' }],
      }).success,
    ).toBe(false)
  })

  test('rejects bare type discriminator without required arms (post Phase 3.2)', () => {
    // Pre-Phase 3.2 these accepted any shape via passthrough. They are now
    // strictly validated and must include their required fields.
    expect(reportDefinitionSchema.safeParse({ type: 'grouped' }).success).toBe(false)
    expect(reportDefinitionSchema.safeParse({ type: 'pivot' }).success).toBe(false)
    expect(reportDefinitionSchema.safeParse({ type: 'chart' }).success).toBe(false)
    expect(reportDefinitionSchema.safeParse({ type: 'summary' }).success).toBe(false)
  })

  test('rejects unknown discriminator value', () => {
    expect(reportDefinitionSchema.safeParse({ type: 'bogus' }).success).toBe(false)
  })
})

describe('reportDefinitionSchema (grouped)', () => {
  test('accepts a minimal grouped definition with defaults', () => {
    const parsed = reportDefinitionSchema.safeParse({
      type: 'grouped',
      fields: ['region', 'amount'],
      groupBy: ['region'],
      measures: [{ field: 'amount', aggregation: 'sum' }],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success && parsed.data.type === 'grouped') {
      expect(parsed.data.filters).toEqual([])
      expect(parsed.data.sort).toEqual([])
    }
  })

  test('rejects grouped without measures', () => {
    expect(
      reportDefinitionSchema.safeParse({
        type: 'grouped',
        fields: ['region'],
        groupBy: ['region'],
        measures: [],
      }).success,
    ).toBe(false)
  })

  test('rejects grouped without groupBy', () => {
    expect(
      reportDefinitionSchema.safeParse({
        type: 'grouped',
        fields: ['region'],
        groupBy: [],
        measures: [{ field: 'amount', aggregation: 'sum' }],
      }).success,
    ).toBe(false)
  })

  test('rejects duplicate measure aliases', () => {
    const parsed = reportDefinitionSchema.safeParse({
      type: 'grouped',
      fields: ['region', 'amount'],
      groupBy: ['region'],
      measures: [
        { field: 'amount', aggregation: 'sum', alias: 'total' },
        { field: 'amount', aggregation: 'avg', alias: 'total' },
      ],
    })
    expect(parsed.success).toBe(false)
  })

  test('rejects bogus aggregation', () => {
    expect(
      reportDefinitionSchema.safeParse({
        type: 'grouped',
        fields: ['region'],
        groupBy: ['region'],
        measures: [{ field: 'amount', aggregation: 'median' }],
      }).success,
    ).toBe(false)
  })
})

describe('reportDefinitionSchema (pivot)', () => {
  test('accepts a minimal pivot', () => {
    const parsed = reportDefinitionSchema.safeParse({
      type: 'pivot',
      rows: ['region'],
      cols: ['segment'],
      value: { field: 'amount', aggregation: 'sum' },
    })
    expect(parsed.success).toBe(true)
  })

  test('rejects pivot with overlapping row + col fields', () => {
    expect(
      reportDefinitionSchema.safeParse({
        type: 'pivot',
        rows: ['region'],
        cols: ['region'],
        value: { field: 'amount', aggregation: 'sum' },
      }).success,
    ).toBe(false)
  })

  test('rejects pivot missing value', () => {
    expect(
      reportDefinitionSchema.safeParse({
        type: 'pivot',
        rows: ['region'],
        cols: ['segment'],
      }).success,
    ).toBe(false)
  })

  test('rejects pivot with empty rows or cols', () => {
    expect(
      reportDefinitionSchema.safeParse({
        type: 'pivot',
        rows: [],
        cols: ['segment'],
        value: { field: 'amount', aggregation: 'sum' },
      }).success,
    ).toBe(false)
    expect(
      reportDefinitionSchema.safeParse({
        type: 'pivot',
        rows: ['region'],
        cols: [],
        value: { field: 'amount', aggregation: 'sum' },
      }).success,
    ).toBe(false)
  })
})

describe('reportDefinitionSchema (summary)', () => {
  test('accepts measures + empty filters default', () => {
    const parsed = reportDefinitionSchema.safeParse({
      type: 'summary',
      measures: [
        { field: 'amount', aggregation: 'sum' },
        { field: 'amount', aggregation: 'avg' },
      ],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success && parsed.data.type === 'summary') {
      expect(parsed.data.filters).toEqual([])
    }
  })

  test('rejects summary with no measures', () => {
    expect(
      reportDefinitionSchema.safeParse({ type: 'summary', measures: [] }).success,
    ).toBe(false)
  })
})

describe('reportDefinitionSchema (chart)', () => {
  test('accepts a minimal bar chart referencing a single measure', () => {
    const parsed = reportDefinitionSchema.safeParse({
      type: 'chart',
      chart: { type: 'bar', xField: 'region', yFields: ['total'] },
      groupBy: ['region'],
      measures: [{ field: 'amount', aggregation: 'sum', alias: 'total' }],
    })
    expect(parsed.success).toBe(true)
  })

  test('rejects pie chart with more than one yField', () => {
    expect(
      reportDefinitionSchema.safeParse({
        type: 'chart',
        chart: { type: 'pie', xField: 'region', yFields: ['total', 'count'] },
      }).success,
    ).toBe(false)
  })

  test('rejects scatter chart with more than one yField', () => {
    expect(
      reportDefinitionSchema.safeParse({
        type: 'chart',
        chart: { type: 'scatter', xField: 'x', yFields: ['y1', 'y2'] },
      }).success,
    ).toBe(false)
  })

  test('rejects chart whose xField is not in declared groupBy', () => {
    expect(
      reportDefinitionSchema.safeParse({
        type: 'chart',
        chart: { type: 'bar', xField: 'region', yFields: ['total'] },
        groupBy: ['country'],
        measures: [{ field: 'amount', aggregation: 'sum', alias: 'total' }],
      }).success,
    ).toBe(false)
  })

  test('rejects chart whose yField is not produced by any measure alias', () => {
    expect(
      reportDefinitionSchema.safeParse({
        type: 'chart',
        chart: { type: 'bar', xField: 'region', yFields: ['totalThatDoesNotExist'] },
        groupBy: ['region'],
        measures: [{ field: 'amount', aggregation: 'sum', alias: 'total' }],
      }).success,
    ).toBe(false)
  })

  test('accepts chart without declared groupBy/measures (free-form chart on raw rows)', () => {
    expect(
      reportDefinitionSchema.safeParse({
        type: 'chart',
        chart: { type: 'line', xField: 'created_at', yFields: ['amount'] },
      }).success,
    ).toBe(true)
  })
})

describe('reportCreateSchema / reportUpdateSchema', () => {
  test('reportCreateSchema rejects malformed datasetId', () => {
    expect(
      reportCreateSchema.safeParse({
        folderId: '11111111-1111-4111-8111-111111111111',
        name: 'Report',
        type: 'flat_list',
        datasetId: 'NoDot',
        definition: { type: 'flat_list', fields: ['id'] },
      }).success,
    ).toBe(false)
  })

  test('reportCreateSchema accepts well-formed input', () => {
    const out = reportCreateSchema.safeParse({
      folderId: '11111111-1111-4111-8111-111111111111',
      name: 'Top customers',
      type: 'flat_list',
      datasetId: 'customers.entities',
      definition: {
        type: 'flat_list',
        fields: ['id', 'display_name'],
        filters: [{ kind: 'literal', field: 'kind', op: 'eq', value: 'person' }],
      },
    })
    expect(out.success).toBe(true)
  })

  test('reportUpdateSchema requires the id', () => {
    expect(reportUpdateSchema.safeParse({ name: 'x' }).success).toBe(false)
    expect(
      reportUpdateSchema.safeParse({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'x',
      }).success,
    ).toBe(true)
  })

  test('reportCreateSchema validates parameter declarations', () => {
    const ok = reportCreateSchema.safeParse({
      folderId: '11111111-1111-4111-8111-111111111111',
      name: 'r',
      type: 'flat_list',
      datasetId: 'customers.entities',
      definition: { type: 'flat_list', fields: ['id'] },
      parameters: [
        { key: 'companyId', kind: 'fk', relatedDatasetId: 'customers.entities' },
        { key: 'status', kind: 'enum', options: ['active', 'archived'] },
      ],
    })
    expect(ok.success).toBe(true)
    const bad = reportCreateSchema.safeParse({
      folderId: '11111111-1111-4111-8111-111111111111',
      name: 'r',
      type: 'flat_list',
      datasetId: 'customers.entities',
      definition: { type: 'flat_list', fields: ['id'] },
      parameters: [{ key: '123-bad-key', kind: 'string' }],
    })
    expect(bad.success).toBe(false)
  })
})

describe('dashboardLayoutSchema', () => {
  test('accepts a minimal layout with default grid', () => {
    const result = dashboardLayoutSchema.safeParse({
      tiles: [{
        id: 'a',
        reportId: '11111111-1111-4111-8111-111111111111',
        x: 0, y: 0, w: 6, h: 4,
      }],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.grid).toEqual({ cols: 12, rowHeight: 80, gap: 8 })
      expect(result.data.tiles[0].mode).toBe('inline')
    }
  })

  test('rejects duplicate tile ids', () => {
    const result = dashboardLayoutSchema.safeParse({
      tiles: [
        { id: 'a', reportId: '11111111-1111-4111-8111-111111111111', x: 0, y: 0, w: 6, h: 4 },
        { id: 'a', reportId: '22222222-2222-4222-8222-222222222222', x: 6, y: 0, w: 6, h: 4 },
      ],
    })
    expect(result.success).toBe(false)
  })

  test('rejects tiles with non-uuid reportId or zero-size cells', () => {
    expect(
      dashboardLayoutSchema.safeParse({
        tiles: [{ id: 'a', reportId: 'not-a-uuid', x: 0, y: 0, w: 6, h: 4 }],
      }).success,
    ).toBe(false)
    expect(
      dashboardLayoutSchema.safeParse({
        tiles: [{ id: 'a', reportId: '11111111-1111-4111-8111-111111111111', x: 0, y: 0, w: 0, h: 4 }],
      }).success,
    ).toBe(false)
  })

  test('accepts param bindings of every supported source', () => {
    const result = dashboardLayoutSchema.safeParse({
      tiles: [{
        id: 'a',
        reportId: '11111111-1111-4111-8111-111111111111',
        x: 0, y: 0, w: 6, h: 4,
        paramBindings: {
          companyId: { source: 'parameter', parameter: 'companyId' },
          region: { source: 'literal', value: 'EU' },
          customer: { source: 'record-field', recordField: 'id' },
        },
      }],
    })
    expect(result.success).toBe(true)
  })
})

describe('dashboardCreateSchema / dashboardUpdateSchema', () => {
  test('reportCreateSchema-like contract: folderId + name + layout required', () => {
    const ok = dashboardCreateSchema.safeParse({
      folderId: '11111111-1111-4111-8111-111111111111',
      name: 'Q2 Pipeline',
      layout: { tiles: [] },
    })
    expect(ok.success).toBe(true)
    const missing = dashboardCreateSchema.safeParse({
      folderId: '11111111-1111-4111-8111-111111111111',
      name: 'Q2 Pipeline',
    })
    expect(missing.success).toBe(false)
  })

  test('dashboardUpdateSchema requires the id', () => {
    expect(dashboardUpdateSchema.safeParse({ name: 'x' }).success).toBe(false)
    expect(
      dashboardUpdateSchema.safeParse({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'x',
      }).success,
    ).toBe(true)
  })
})

describe('reportRunSchema', () => {
  test('accepts empty body', () => {
    expect(reportRunSchema.safeParse({}).success).toBe(true)
  })
  test('accepts params and mode', () => {
    const out = reportRunSchema.safeParse({
      params: { status: 'paid' },
      mode: 'async',
    })
    expect(out.success).toBe(true)
  })
  test('rejects bogus mode', () => {
    expect(reportRunSchema.safeParse({ mode: 'streaming' }).success).toBe(false)
  })
})
