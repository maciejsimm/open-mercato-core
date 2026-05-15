import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig, TenantSetupContext } from '@open-mercato/shared/modules/setup'
import { ReportFolder } from './data/entities'

const PUBLIC_ROOT_NAME = 'Public'

async function ensurePublicRoot(ctx: TenantSetupContext): Promise<void> {
  const em = ctx.em as EntityManager
  const existing = await em.findOne(ReportFolder, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    parentFolderId: null,
    kind: 'public',
    deletedAt: null,
  } as Record<string, unknown>)
  if (existing) return
  const folder = em.create(ReportFolder, {
    organizationId: ctx.organizationId,
    tenantId: ctx.tenantId,
    parentFolderId: null,
    ownerUserId: null,
    kind: 'public',
    name: PUBLIC_ROOT_NAME,
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  em.persist(folder)
  await em.flush()
}

export const setup: ModuleSetupConfig = {
  onTenantCreated: ensurePublicRoot,
  seedDefaults: ensurePublicRoot,
  defaultRoleFeatures: {
    admin: [
      'reports.view',
      'reports.author',
      'reports.share',
      'reports.schedule',
      'reports.export',
      'reports.embed.manage',
      'reports.admin',
    ],
    employee: [
      'reports.view',
      'reports.author',
      'reports.schedule',
      'reports.export',
    ],
  },
}

export default setup
