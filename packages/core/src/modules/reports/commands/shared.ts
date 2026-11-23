import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ReportFolder, ReportFolderShare } from '../data/entities'
import type { ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import type { FolderAclContext, ReportFolderRecord, ReportFolderShareRecord } from '../lib/folder-acl'
import { buildFolderAclContext, resolveAccessForUser, type ReportsAccess } from '../lib/access'
import { loadDataset } from '../lib/datasets-registry'
import { FieldAclDeniedError, validateDefinitionAgainstAcl } from '../lib/field-redact'

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
  const access = await loadCommandAccess(ctx, em, tenantId, organizationId)
  return { folder, acl: buildFolderAclContext(access, shares) }
}

/**
 * Live ACL + role ids of the command's actor. Never trusts JWT `features` /
 * `roles` claims: role shares store role UUIDs and grants can change after
 * the token was issued.
 */
export async function loadCommandAccess(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  tenantId: string,
  organizationId: string,
): Promise<ReportsAccess> {
  const userId = ctx.auth?.sub
  if (!userId) throw new CrudHttpError(401, { error: 'User scope required' })
  return resolveAccessForUser(ctx.container, em, userId, { tenantId, organizationId })
}

/**
 * Save-time field-ACL enforcement (point 2 of the three-point contract):
 * the saving user must be able to see the dataset and every field the
 * definition references.
 */
export async function assertDefinitionSavable(
  datasetId: string,
  definition: ReportDefinition,
  userFeatures: ReadonlySet<string>,
): Promise<void> {
  const dataset = await loadDataset(datasetId, userFeatures)
  if (!dataset) throw new CrudHttpError(400, { error: 'Dataset not found or not visible', code: 'REPORT_DATASET_NOT_FOUND' })
  try {
    validateDefinitionAgainstAcl(definition, dataset, userFeatures)
  } catch (err) {
    if (err instanceof FieldAclDeniedError) {
      throw new CrudHttpError(403, { error: 'The report references fields you may not see', code: err.code, fields: err.fields })
    }
    throw err
  }
}
