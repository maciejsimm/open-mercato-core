import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ReportFolder, ReportFolderShare } from '../data/entities'
import type { FolderAclContext, ReportFolderRecord, ReportFolderShareRecord } from '../lib/folder-acl'

export function requireTenant(ctx: CommandRuntimeContext): { tenantId: string; organizationId: string; userId: string } {
  const tenantId = ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  const userId = ctx.auth?.sub ?? null
  if (!tenantId) throw new CrudHttpError(401, { error: 'Tenant scope required' })
  if (!organizationId) throw new CrudHttpError(400, { error: 'Organization scope required' })
  if (!userId) throw new CrudHttpError(401, { error: 'User scope required' })
  return { tenantId, organizationId, userId }
}

export async function loadFolderRecord(
  em: EntityManager,
  folderId: string,
  tenantId: string,
  organizationId: string,
): Promise<ReportFolderRecord | null> {
  const folder = await em.findOne(ReportFolder, {
    id: folderId,
    tenantId,
    organizationId,
    deletedAt: null,
  } as Record<string, unknown>)
  if (!folder) return null
  return {
    id: folder.id,
    kind: folder.kind,
    ownerUserId: folder.ownerUserId ?? null,
    organizationId: folder.organizationId,
    tenantId: folder.tenantId,
  }
}

export async function loadFolderShares(
  em: EntityManager,
  folderId: string,
): Promise<ReportFolderShareRecord[]> {
  const shares = await em.find(ReportFolderShare, { folderId } as Record<string, unknown>)
  return shares.map((s) => ({
    id: s.id,
    folderId: s.folderId,
    principalType: s.principalType,
    principalId: s.principalId,
    permission: s.permission,
  }))
}

export async function loadAclContext(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  folderId: string,
  tenantId: string,
  organizationId: string,
): Promise<{ folder: ReportFolderRecord; acl: FolderAclContext }> {
  const folder = await loadFolderRecord(em, folderId, tenantId, organizationId)
  if (!folder) throw new CrudHttpError(404, { error: 'Folder not found' })
  const shares = await loadFolderShares(em, folderId)
  const acl: FolderAclContext = {
    userId: ctx.auth?.sub ?? '',
    roleIds: new Set<string>(Array.isArray(ctx.auth?.roles) ? (ctx.auth?.roles as string[]) : []),
    userFeatures: new Set<string>((ctx.auth as { features?: string[] } | null)?.features ?? []),
    shares,
  }
  return { folder, acl }
}
