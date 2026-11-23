import type { EntityManager } from '@mikro-orm/postgresql'
import { Report, ReportFolder, ReportFolderShare } from '../data/entities'
import { canViewFolder, resolveArtifactPermission, type ReportFolderRecord } from './folder-acl'
import { buildFolderAclContext, type ReportsAccess } from './access'

/**
 * Can `access` run (view) this report right now? Re-evaluated on every run
 * path — sync, async worker, schedule, download — against live ACL, so a
 * revoked folder share or role takes effect immediately.
 */
export async function canRunReport(em: EntityManager, report: Report, access: ReportsAccess): Promise<boolean> {
  const folder = await em.findOne(ReportFolder, {
    id: report.folderId,
    tenantId: access.tenantId,
    organizationId: access.organizationId,
    deletedAt: null,
  } as Record<string, unknown>)
  if (!folder) return false
  const shares = await em.find(ReportFolderShare, { folderId: folder.id } as Record<string, unknown>)
  const folderRec: ReportFolderRecord = {
    id: folder.id,
    kind: folder.kind,
    ownerUserId: folder.ownerUserId ?? null,
    organizationId: folder.organizationId,
    tenantId: folder.tenantId,
  }
  const ctx = buildFolderAclContext(
    access,
    shares.map((s) => ({
      id: s.id,
      folderId: s.folderId,
      principalType: s.principalType,
      principalId: s.principalId,
      permission: s.permission,
    })),
  )
  if (!canViewFolder(folderRec, ctx)) return false
  return resolveArtifactPermission({ folder: folderRec, artifactOwnerUserId: report.ownerUserId, ctx }) !== null
}

export async function loadScopedReport(
  em: EntityManager,
  reportId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<Report | null> {
  return em.findOne(Report, {
    id: reportId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as Record<string, unknown>)
}
