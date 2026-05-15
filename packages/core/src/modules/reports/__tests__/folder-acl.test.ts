import {
  canEditFolder,
  canShareFolder,
  canViewFolder,
  isReportsAdmin,
  resolveArtifactPermission,
  resolveFolderPermission,
  type FolderAclContext,
  type ReportFolderRecord,
  type ReportFolderShareRecord,
} from '../lib/folder-acl'

const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const ROLE_HR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const TENANT = 'tenant-1'
const ORG = 'org-1'

const publicFolder: ReportFolderRecord = {
  id: 'f-public',
  kind: 'public',
  ownerUserId: null,
  organizationId: ORG,
  tenantId: TENANT,
}
const privateA: ReportFolderRecord = {
  id: 'f-priv-a',
  kind: 'private',
  ownerUserId: USER_A,
  organizationId: ORG,
  tenantId: TENANT,
}

function ctx(opts: Partial<FolderAclContext> & Pick<FolderAclContext, 'userId'>): FolderAclContext {
  return {
    userId: opts.userId,
    roleIds: opts.roleIds ?? new Set<string>(),
    userFeatures: opts.userFeatures ?? new Set(['reports.view']),
    shares: opts.shares ?? [],
  }
}

describe('isReportsAdmin', () => {
  test('detects explicit feature', () => {
    expect(isReportsAdmin(new Set(['reports.admin']))).toBe(true)
  })
  test('detects via wildcard reports.*', () => {
    expect(isReportsAdmin(new Set(['reports.*']))).toBe(true)
  })
  test('detects via god-mode *', () => {
    expect(isReportsAdmin(new Set(['*']))).toBe(true)
  })
  test('rejects when feature missing', () => {
    expect(isReportsAdmin(new Set(['reports.view']))).toBe(false)
  })
})

describe('canViewFolder', () => {
  test('public folder visible to anyone with reports.view', () => {
    expect(canViewFolder(publicFolder, ctx({ userId: USER_B }))).toBe(true)
  })
  test('public folder hidden when user lacks reports.view', () => {
    expect(canViewFolder(publicFolder, ctx({ userId: USER_B, userFeatures: new Set() }))).toBe(false)
  })
  test('public folder visible to admins even without reports.view', () => {
    expect(
      canViewFolder(publicFolder, ctx({ userId: USER_B, userFeatures: new Set(['reports.admin']) })),
    ).toBe(true)
  })
  test('private folder visible to its owner', () => {
    expect(canViewFolder(privateA, ctx({ userId: USER_A }))).toBe(true)
  })
  test('private folder hidden from non-owner without share', () => {
    expect(canViewFolder(privateA, ctx({ userId: USER_B }))).toBe(false)
  })
  test('private folder visible via user share', () => {
    const shares: ReportFolderShareRecord[] = [
      { id: 's1', folderId: 'f-priv-a', principalType: 'user', principalId: USER_B, permission: 'view' },
    ]
    expect(canViewFolder(privateA, ctx({ userId: USER_B, shares }))).toBe(true)
  })
  test('private folder visible via role share', () => {
    const shares: ReportFolderShareRecord[] = [
      { id: 's2', folderId: 'f-priv-a', principalType: 'role', principalId: ROLE_HR, permission: 'view' },
    ]
    expect(
      canViewFolder(privateA, ctx({ userId: USER_B, roleIds: new Set([ROLE_HR]), shares })),
    ).toBe(true)
  })
  test('private folder visible to admin god-mode', () => {
    expect(canViewFolder(privateA, ctx({ userId: USER_B, userFeatures: new Set(['reports.admin']) }))).toBe(true)
  })
})

describe('canEditFolder', () => {
  test('owner of private folder edits', () => {
    expect(canEditFolder(privateA, ctx({ userId: USER_A }))).toBe(true)
  })
  test('public folder cannot be edited by non-admins', () => {
    expect(canEditFolder(publicFolder, ctx({ userId: USER_A }))).toBe(false)
  })
  test('public folder editable by admin god-mode', () => {
    expect(canEditFolder(publicFolder, ctx({ userId: USER_B, userFeatures: new Set(['reports.admin']) }))).toBe(true)
  })
  test('private folder editable via share permission edit', () => {
    const shares: ReportFolderShareRecord[] = [
      { id: 's1', folderId: 'f-priv-a', principalType: 'user', principalId: USER_B, permission: 'edit' },
    ]
    expect(canEditFolder(privateA, ctx({ userId: USER_B, shares }))).toBe(true)
  })
  test('view-only share does not grant edit', () => {
    const shares: ReportFolderShareRecord[] = [
      { id: 's1', folderId: 'f-priv-a', principalType: 'user', principalId: USER_B, permission: 'view' },
    ]
    expect(canEditFolder(privateA, ctx({ userId: USER_B, shares }))).toBe(false)
  })
})

describe('resolveFolderPermission', () => {
  test('returns edit when canEditFolder=true', () => {
    expect(resolveFolderPermission(privateA, ctx({ userId: USER_A }))).toBe('edit')
  })
  test('returns view when only canViewFolder=true', () => {
    expect(resolveFolderPermission(publicFolder, ctx({ userId: USER_B }))).toBe('view')
  })
  test('returns null when neither', () => {
    expect(resolveFolderPermission(privateA, ctx({ userId: USER_B }))).toBeNull()
  })
})

describe('resolveArtifactPermission', () => {
  test('artifact owner always edits even on view-only shared folder', () => {
    const shares: ReportFolderShareRecord[] = [
      { id: 's1', folderId: 'f-priv-a', principalType: 'user', principalId: USER_B, permission: 'view' },
    ]
    const perm = resolveArtifactPermission({
      folder: privateA,
      artifactOwnerUserId: USER_B,
      ctx: ctx({ userId: USER_B, shares }),
    })
    expect(perm).toBe('edit')
  })
  test('non-owner with view share gets view', () => {
    const shares: ReportFolderShareRecord[] = [
      { id: 's1', folderId: 'f-priv-a', principalType: 'user', principalId: USER_B, permission: 'view' },
    ]
    const perm = resolveArtifactPermission({
      folder: privateA,
      artifactOwnerUserId: USER_A,
      ctx: ctx({ userId: USER_B, shares }),
    })
    expect(perm).toBe('view')
  })
  test('user who cannot see folder cannot see artifact', () => {
    const perm = resolveArtifactPermission({
      folder: privateA,
      artifactOwnerUserId: USER_A,
      ctx: ctx({ userId: USER_B }),
    })
    expect(perm).toBeNull()
  })
})

describe('canShareFolder', () => {
  test('rejects sharing public folders entirely', () => {
    expect(canShareFolder(publicFolder, ctx({ userId: USER_A, userFeatures: new Set(['reports.admin']) }))).toBe(false)
  })
  test('owner can share their private folder', () => {
    expect(canShareFolder(privateA, ctx({ userId: USER_A }))).toBe(true)
  })
  test('user with edit share can re-share', () => {
    const shares: ReportFolderShareRecord[] = [
      { id: 's1', folderId: 'f-priv-a', principalType: 'user', principalId: USER_B, permission: 'edit' },
    ]
    expect(canShareFolder(privateA, ctx({ userId: USER_B, shares }))).toBe(true)
  })
  test('view-only share cannot re-share', () => {
    const shares: ReportFolderShareRecord[] = [
      { id: 's1', folderId: 'f-priv-a', principalType: 'user', principalId: USER_B, permission: 'view' },
    ]
    expect(canShareFolder(privateA, ctx({ userId: USER_B, shares }))).toBe(false)
  })
  test('admin can share any private folder', () => {
    expect(canShareFolder(privateA, ctx({ userId: USER_B, userFeatures: new Set(['reports.admin']) }))).toBe(true)
  })
})
