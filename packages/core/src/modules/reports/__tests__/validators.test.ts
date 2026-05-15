import {
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

  test('discriminates other definition types (placeholder until Phase 3)', () => {
    // Placeholders accept any shape so saves do not lose data, but the
    // execution engine will refuse them until Phase 3.
    expect(reportDefinitionSchema.safeParse({ type: 'grouped' }).success).toBe(true)
    expect(reportDefinitionSchema.safeParse({ type: 'pivot' }).success).toBe(true)
    expect(reportDefinitionSchema.safeParse({ type: 'chart' }).success).toBe(true)
    expect(reportDefinitionSchema.safeParse({ type: 'summary' }).success).toBe(true)
  })

  test('rejects unknown discriminator value', () => {
    expect(reportDefinitionSchema.safeParse({ type: 'bogus' }).success).toBe(false)
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
