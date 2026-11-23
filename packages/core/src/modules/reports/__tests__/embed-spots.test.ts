import type { EntityManager } from '@mikro-orm/postgresql'
import type { ParameterDef } from '@open-mercato/shared/modules/reports/dsl'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { injectionTable } from '../widgets/injection-table'
import {
  EMBED_HOST_SPOTS,
  EMBED_HOST_WIDGET_ID,
  draftsToBindings,
  suggestBindingDraft,
  getEmbedHostSpot,
  getEmbedHostSpotForEntity,
  isKnownEmbedSpot,
  readParameterDefs,
  resolveEmbedParams,
  validateEmbedConfig,
} from '../lib/embed-spots'
import { embedCreateSchema, embedUpdateSchema } from '../data/validators'
import { assertValidEmbedTarget } from '../commands/embed'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

const mockedFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

const PERSON_SPOT = 'detail:customers.person:after-header'
const COMPANY_SPOT = 'detail:customers.company:after-header'
const ARTIFACT_ID = '6f1c6a52-1f4e-4c8c-9a43-1f0d4f3f2b11'

const params: ParameterDef[] = [
  { key: 'companyId', kind: 'fk', required: true },
  { key: 'region', kind: 'string' },
]

describe('embed host-spot registry', () => {
  it('lists exactly the spots the record-embed-host widget is injected into', () => {
    const injectedSpots = Object.entries(injectionTable)
      .filter(([, slots]) => {
        const list = Array.isArray(slots) ? slots : [slots]
        return list.some((slot) => (typeof slot === 'string' ? slot : slot.widgetId) === EMBED_HOST_WIDGET_ID)
      })
      .map(([spotId]) => spotId)
      .sort()
    expect(EMBED_HOST_SPOTS.map((spot) => spot.spotId).sort()).toEqual(injectedSpots)
  })

  it('gives every spot a label key, a host entity and labelled host fields', () => {
    for (const spot of EMBED_HOST_SPOTS) {
      expect(spot.labelKey).toMatch(/^reports\.embedSpots\./)
      expect(spot.hostEntityId).toMatch(/^[a-z_]+\.[a-z_]+$/)
      expect(spot.fields.length).toBeGreaterThan(0)
      for (const field of spot.fields) {
        expect(field.labelKey).toMatch(/^reports\.embedSpots\.fields\./)
        expect(field.label.length).toBeGreaterThan(0)
      }
      expect(new Set(spot.fields.map((field) => field.path)).size).toBe(spot.fields.length)
    }
  })

  it('looks spots up by id and by host entity', () => {
    expect(getEmbedHostSpot(PERSON_SPOT)?.hostEntityId).toBe('customers.person')
    expect(getEmbedHostSpotForEntity('customers.company')?.spotId).toBe(COMPANY_SPOT)
    expect(isKnownEmbedSpot('detail:customers.deal:after-header')).toBe(false)
    expect(isKnownEmbedSpot(undefined)).toBe(false)
  })
})

describe('resolveEmbedParams', () => {
  it('reads dotted record fields and literal values', () => {
    const data = { company: { id: 'c-1' }, profile: { industry: '' } }
    expect(
      resolveEmbedParams(
        {
          companyId: { source: 'record-field', recordField: 'company.id' },
          industry: { source: 'record-field', recordField: 'profile.industry' },
          region: { source: 'literal', value: 'EMEA' },
        },
        data,
      ),
    ).toEqual({ companyId: 'c-1', region: 'EMEA' })
  })
})

describe('validateEmbedConfig', () => {
  it('accepts a spot with every required parameter bound', () => {
    expect(
      validateEmbedConfig({
        hostSpotId: COMPANY_SPOT,
        paramBindings: {
          companyId: { source: 'record-field', recordField: 'company.id' },
          region: { source: 'literal', value: 'EMEA' },
        },
        parameters: params,
      }),
    ).toEqual([])
  })

  it('rejects an unknown spot id', () => {
    const issues = validateEmbedConfig({ hostSpotId: 'detail:sales.order:after-header', parameters: [] })
    expect(issues.map((issue) => issue.code)).toEqual(['unknown_spot'])
  })

  it('rejects a host entity that does not match the spot', () => {
    const issues = validateEmbedConfig({
      hostSpotId: PERSON_SPOT,
      hostEntityId: 'customers.company',
      parameters: [],
    })
    expect(issues.map((issue) => issue.code)).toEqual(['entity_mismatch'])
  })

  it('rejects bindings to parameters the artifact does not declare', () => {
    const issues = validateEmbedConfig({
      hostSpotId: COMPANY_SPOT,
      paramBindings: {
        companyId: { source: 'record-field', recordField: 'company.id' },
        ownerId: { source: 'record-field', recordField: 'company.ownerUserId' },
      },
      parameters: params,
    })
    expect(issues).toEqual([
      expect.objectContaining({ code: 'undeclared_parameter', param: 'ownerId', path: 'paramBindings.ownerId' }),
    ])
  })

  it('blocks a required parameter left unbound', () => {
    const issues = validateEmbedConfig({ hostSpotId: COMPANY_SPOT, paramBindings: {}, parameters: params })
    expect(issues).toEqual([expect.objectContaining({ code: 'required_parameter_unbound', param: 'companyId' })])
  })

  it('treats a required parameter with a default value as satisfied', () => {
    const issues = validateEmbedConfig({
      hostSpotId: COMPANY_SPOT,
      parameters: [{ key: 'range', kind: 'date_range', required: true, defaultValue: 'last_30_days' }],
    })
    expect(issues).toEqual([])
  })

  it('rejects record fields the host entity does not expose but allows custom fields', () => {
    const issues = validateEmbedConfig({
      hostSpotId: PERSON_SPOT,
      paramBindings: {
        companyId: { source: 'record-field', recordField: 'company.id' },
        region: { source: 'record-field', recordField: 'customFields.region' },
      },
      parameters: params,
    })
    expect(issues.map((issue) => `${issue.code}:${issue.param}`)).toEqual(['unknown_record_field:companyId'])
  })

  it('rejects an empty fixed value', () => {
    const issues = validateEmbedConfig({
      hostSpotId: COMPANY_SPOT,
      paramBindings: {
        companyId: { source: 'record-field', recordField: 'company.id' },
        region: { source: 'literal', value: '  ' },
      },
      parameters: params,
    })
    expect(issues.map((issue) => issue.code)).toEqual(['empty_literal'])
  })
})

describe('readParameterDefs', () => {
  it('keeps well-formed entries only', () => {
    expect(readParameterDefs([{ key: 'a', kind: 'string' }, { key: 1 }, null, 'x'])).toEqual([{ key: 'a', kind: 'string' }])
    expect(readParameterDefs(null)).toEqual([])
  })
})

describe('embed schemas', () => {
  const base = {
    hostSpotId: COMPANY_SPOT,
    artifactType: 'report' as const,
    artifactId: ARTIFACT_ID,
  }

  it('accepts a registered spot without an explicit host entity', () => {
    expect(embedCreateSchema.safeParse(base).success).toBe(true)
  })

  it('rejects an unknown spot id on create and update', () => {
    expect(embedCreateSchema.safeParse({ ...base, hostSpotId: 'detail:customers.deal:after-header' }).success).toBe(false)
    expect(embedUpdateSchema.safeParse({ id: ARTIFACT_ID, hostSpotId: 'nope:spot' }).success).toBe(false)
  })

  it('accepts literal and record-field bindings', () => {
    const parsed = embedCreateSchema.safeParse({
      ...base,
      paramBindings: {
        companyId: { source: 'record-field', recordField: 'company.id' },
        region: { source: 'literal', value: 'EMEA' },
      },
    })
    expect(parsed.success).toBe(true)
  })
})

describe('assertValidEmbedTarget', () => {
  const em = {} as EntityManager
  const scope = { tenantId: 't-1', organizationId: 'o-1' }

  beforeEach(() => mockedFindOne.mockReset())

  async function captureError(promise: Promise<unknown>): Promise<CrudHttpError> {
    try {
      await promise
    } catch (err) {
      if (err instanceof CrudHttpError) return err
      throw err
    }
    throw new Error('[internal] expected CrudHttpError')
  }

  it('derives the host entity from the spot when bindings are valid', async () => {
    mockedFindOne.mockResolvedValueOnce({ parametersJson: params })
    await expect(
      assertValidEmbedTarget(em, scope, {
        hostSpotId: COMPANY_SPOT,
        artifactType: 'report',
        artifactId: ARTIFACT_ID,
        paramBindings: { companyId: { source: 'record-field', recordField: 'company.id' } },
      }),
    ).resolves.toBe('customers.company')
  })

  it('rejects a binding to an undeclared parameter with a 400', async () => {
    mockedFindOne.mockResolvedValueOnce({ parametersJson: params })
    const err = await captureError(
      assertValidEmbedTarget(em, scope, {
        hostSpotId: COMPANY_SPOT,
        artifactType: 'dashboard',
        artifactId: ARTIFACT_ID,
        paramBindings: {
          companyId: { source: 'record-field', recordField: 'company.id' },
          stage: { source: 'literal', value: 'won' },
        },
      }),
    )
    expect(err.status).toBe(400)
    expect(err.body).toEqual(expect.objectContaining({ code: 'EMBED_INVALID' }))
  })

  it('rejects an unknown spot with a 400', async () => {
    mockedFindOne.mockResolvedValueOnce({ parametersJson: [] })
    const err = await captureError(
      assertValidEmbedTarget(em, scope, {
        hostSpotId: 'detail:customers.deal:after-header',
        artifactType: 'report',
        artifactId: ARTIFACT_ID,
        paramBindings: {},
      }),
    )
    expect(err.status).toBe(400)
  })

  it('rejects an artifact outside the caller scope', async () => {
    mockedFindOne.mockResolvedValueOnce(null)
    const err = await captureError(
      assertValidEmbedTarget(em, scope, {
        hostSpotId: COMPANY_SPOT,
        artifactType: 'report',
        artifactId: ARTIFACT_ID,
        paramBindings: {},
      }),
    )
    expect(err.status).toBe(400)
    expect(err.body).toEqual(expect.objectContaining({ code: 'EMBED_ARTIFACT_NOT_FOUND' }))
  })
})

describe('configurator drafts', () => {
  const companySpot = getEmbedHostSpot(COMPANY_SPOT)

  it('pre-binds fk parameters to a matching host id field', () => {
    expect(suggestBindingDraft(companySpot, { key: 'companyId', kind: 'fk' })).toEqual({ source: 'record-field', recordField: 'company.id' })
    expect(suggestBindingDraft(companySpot, { key: 'ownerUserId', kind: 'fk' })).toEqual({ source: 'record-field', recordField: 'company.ownerUserId' })
    expect(suggestBindingDraft(companySpot, { key: 'region', kind: 'string' })).toEqual({ source: 'none' })
  })

  it('keeps an existing binding', () => {
    expect(suggestBindingDraft(companySpot, { key: 'region', kind: 'string' }, { source: 'literal', value: 'EMEA' }))
      .toEqual({ source: 'literal', value: 'EMEA' })
  })

  it('omits unbound rows when building bindings', () => {
    expect(draftsToBindings({
      a: { source: 'none' },
      b: { source: 'record-field', recordField: 'company.id' },
      c: { source: 'literal', value: 3 },
    })).toEqual({ b: { source: 'record-field', recordField: 'company.id' }, c: { source: 'literal', value: 3 } })
  })
})
