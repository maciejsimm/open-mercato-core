const findWithDecryptionMock = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))
jest.mock('@open-mercato/core/modules/auth/data/entities', () => ({ UserRole: class UserRole {}, User: class User {} }))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))

import type { EntityManager } from '@mikro-orm/postgresql'
import { loadUserFeatures, resolveUserRoleIds } from '../lib/access'
import { canViewFolder, type FolderAclContext } from '../lib/folder-acl'
import { hasReportFeature } from '../lib/feature-access'

const em = {} as EntityManager
const scope = { tenantId: 't1', organizationId: 'o1' }

describe('F2 — role shares match role UUIDs, not JWT role names', () => {
  beforeEach(() => findWithDecryptionMock.mockReset())

  test('resolveUserRoleIds returns live role ids of the tenant only', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { role: { id: 'role-uuid-sales', tenantId: 't1', deletedAt: null } },
      { role: { id: 'role-uuid-other-tenant', tenantId: 't2', deletedAt: null } },
      { role: { id: 'role-uuid-deleted', tenantId: 't1', deletedAt: new Date() } },
    ])
    const ids = await resolveUserRoleIds(em, 'u1', scope)
    expect(Array.from(ids)).toEqual(['role-uuid-sales'])
  })

  test('a private folder shared with the role UUID is visible to a holder of that role', async () => {
    findWithDecryptionMock.mockResolvedValue([{ role: { id: 'role-uuid-sales', tenantId: 't1' } }])
    const roleIds = await resolveUserRoleIds(em, 'u1', scope)
    const ctx: FolderAclContext = {
      userId: 'u1',
      roleIds,
      userFeatures: new Set(['reports.view']),
      shares: [{ id: 's1', folderId: 'f1', principalType: 'role', principalId: 'role-uuid-sales', permission: 'view' }],
    }
    const folder = { id: 'f1', kind: 'private' as const, ownerUserId: 'someone-else', organizationId: 'o1', tenantId: 't1' }
    expect(canViewFolder(folder, ctx)).toBe(true)
    expect(canViewFolder(folder, { ...ctx, roleIds: new Set(['sales']) })).toBe(false)
  })
})

describe('F4 — shared feature policy', () => {
  test('wildcards grant; unrelated grants deny', () => {
    expect(hasReportFeature(new Set(['reports.*']), 'reports.admin')).toBe(true)
    expect(hasReportFeature(new Set(['*']), 'reports.admin')).toBe(true)
    expect(hasReportFeature(new Set(['reports.view']), 'reports.admin')).toBe(false)
    expect(hasReportFeature(new Set(['reportsx.*']), 'reports.admin')).toBe(false)
  })

  test('loadUserFeatures maps super-admin to the wildcard and otherwise uses live grants', async () => {
    const rbac = { loadAcl: jest.fn().mockResolvedValueOnce({ isSuperAdmin: true, features: [] }).mockResolvedValueOnce({ isSuperAdmin: false, features: ['reports.view'] }) }
    expect(Array.from(await loadUserFeatures(rbac as never, 'u1', scope))).toEqual(['*'])
    expect(Array.from(await loadUserFeatures(rbac as never, 'u1', scope))).toEqual(['reports.view'])
  })
})
