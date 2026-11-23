import { hasReportFeature } from './feature-access'

export type ReportFolderRecord = {
  id: string
  kind: 'private' | 'public'
  ownerUserId: string | null
  organizationId: string
  tenantId: string
}

export type ReportFolderShareRecord = {
  id: string
  folderId: string
  principalType: 'user' | 'role'
  principalId: string
  permission: 'view' | 'edit'
}

export type FolderAclContext = {
  userId: string
  roleIds: ReadonlySet<string>
  /** Resolved features for the running user, including expanded wildcards. */
  userFeatures: ReadonlySet<string>
  /** Shares relevant to the folder (caller should pre-filter by folderId). */
  shares: ReadonlyArray<ReportFolderShareRecord>
}

export function isReportsAdmin(features: ReadonlySet<string>): boolean {
  return hasReportFeature(features, 'reports.admin')
}

function principalMatches(
  share: ReportFolderShareRecord,
  ctx: { userId: string; roleIds: ReadonlySet<string> },
): boolean {
  if (share.principalType === 'user') return share.principalId === ctx.userId
  return ctx.roleIds.has(share.principalId)
}

/**
 * Can `ctx.userId` see this folder?
 *
 * Visibility rules (per spec):
 *   - public folders → visible to anyone with reports.view
 *   - private folders → visible to the owner, or anyone holding a share
 *     grant (view OR edit), or admins
 */
export function canViewFolder(folder: ReportFolderRecord, ctx: FolderAclContext): boolean {
  if (isReportsAdmin(ctx.userFeatures)) return true
  if (!hasReportFeature(ctx.userFeatures, 'reports.view')) return false
  if (folder.kind === 'public') return true
  if (folder.ownerUserId === ctx.userId) return true
  return ctx.shares.some((s) => s.folderId === folder.id && principalMatches(s, ctx))
}

/**
 * Can `ctx.userId` edit (rename / move / delete / add children to) this folder?
 *
 * Edit rules:
 *   - reports.admin god mode
 *   - owner of a private folder
 *   - share grant with permission='edit'
 *   - public folder edits require reports.admin (only admins manage public
 *     top-level subfolders)
 */
export function canEditFolder(folder: ReportFolderRecord, ctx: FolderAclContext): boolean {
  if (isReportsAdmin(ctx.userFeatures)) return true
  if (folder.kind === 'public') return false
  if (folder.ownerUserId === ctx.userId) return true
  return ctx.shares.some(
    (s) => s.folderId === folder.id && s.permission === 'edit' && principalMatches(s, ctx),
  )
}

/**
 * Resolve the **effective** permission level for a folder. Returns null
 * when the user cannot see the folder at all.
 */
export function resolveFolderPermission(
  folder: ReportFolderRecord,
  ctx: FolderAclContext,
): 'view' | 'edit' | null {
  if (canEditFolder(folder, ctx)) return 'edit'
  if (canViewFolder(folder, ctx)) return 'view'
  return null
}

/**
 * Permission inheritance for an artifact (Report / Dashboard) living in a
 * folder. Owners always retain edit on their own artifacts even when the
 * folder is shared view-only.
 */
export function resolveArtifactPermission(args: {
  folder: ReportFolderRecord
  artifactOwnerUserId: string
  ctx: FolderAclContext
}): 'view' | 'edit' | null {
  const folderPerm = resolveFolderPermission(args.folder, args.ctx)
  if (!folderPerm) return null
  if (folderPerm === 'edit') return 'edit'
  if (args.artifactOwnerUserId === args.ctx.userId) return 'edit'
  return 'view'
}

/**
 * Shares are only valid on private folders. Validators reject shares on
 * public folders; this helper centralises the rule so commands can use the
 * same guard.
 */
export function canShareFolder(folder: ReportFolderRecord, ctx: FolderAclContext): boolean {
  if (folder.kind !== 'private') return false
  if (isReportsAdmin(ctx.userFeatures)) return true
  if (folder.ownerUserId === ctx.userId) return true
  return ctx.shares.some(
    (s) => s.folderId === folder.id && s.permission === 'edit' && principalMatches(s, ctx),
  )
}
