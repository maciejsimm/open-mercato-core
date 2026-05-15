import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { ReportDashboard } from '../data/entities'
import {
  dashboardCreateSchema,
  dashboardDeleteSchema,
  dashboardMoveSchema,
  dashboardUpdateSchema,
  type DashboardCreateInput,
  type DashboardDeleteInput,
  type DashboardMoveInput,
  type DashboardUpdateInput,
} from '../data/validators'
import { canEditFolder, resolveArtifactPermission } from '../lib/folder-acl'
import { loadAclContext, requireTenant } from './shared'

const dashboardIndexer: CrudIndexerConfig<ReportDashboard> = {
  entityType: 'reports:dashboard',
}
const dashboardEvents: CrudEventsConfig<ReportDashboard> = {
  module: 'reports',
  entity: 'dashboard',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const createDashboardCommand: CommandHandler<DashboardCreateInput, { dashboardId: string }> = {
  id: 'reports.dashboard.create',
  async execute(rawInput, ctx) {
    const input = dashboardCreateSchema.parse(rawInput)
    const { tenantId, organizationId, userId } = requireTenant(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { folder, acl } = await loadAclContext(ctx, em, input.folderId, tenantId, organizationId)
    if (!canEditFolder(folder, acl)) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    const dashboard = em.create(ReportDashboard, {
      organizationId,
      tenantId,
      folderId: input.folderId,
      ownerUserId: userId,
      name: input.name,
      description: input.description ?? null,
      layoutJson: input.layout,
      parametersJson: input.parameters ?? [],
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(dashboard)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: dashboard,
      identifiers: { id: dashboard.id, organizationId, tenantId },
      indexer: dashboardIndexer,
      events: dashboardEvents,
    })
    return { dashboardId: dashboard.id }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'Create dashboard',
    resourceKind: 'reports.dashboard',
    resourceId: result.dashboardId,
  }),
}

const updateDashboardCommand: CommandHandler<DashboardUpdateInput, { dashboardId: string }> = {
  id: 'reports.dashboard.update',
  async execute(rawInput, ctx) {
    const input = dashboardUpdateSchema.parse(rawInput)
    const { tenantId, organizationId } = requireTenant(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const dashboard = await em.findOne(ReportDashboard, {
      id: input.id,
      tenantId,
      organizationId,
      deletedAt: null,
    } as Record<string, unknown>)
    if (!dashboard) throw new CrudHttpError(404, { error: 'Dashboard not found' })

    if (input.version !== undefined && dashboard.version !== input.version) {
      throw new CrudHttpError(409, { error: 'Conflict — reload and retry' })
    }

    const { folder, acl } = await loadAclContext(ctx, em, dashboard.folderId, tenantId, organizationId)
    const perm = resolveArtifactPermission({
      folder,
      artifactOwnerUserId: dashboard.ownerUserId,
      ctx: acl,
    })
    if (perm !== 'edit') throw new CrudHttpError(403, { error: 'Forbidden' })

    if (input.name !== undefined) dashboard.name = input.name
    if (input.description !== undefined) dashboard.description = input.description ?? null
    if (input.layout !== undefined) dashboard.layoutJson = input.layout
    if (input.parameters !== undefined) dashboard.parametersJson = input.parameters
    if (input.folderId !== undefined && input.folderId !== dashboard.folderId) {
      const dest = await loadAclContext(ctx, em, input.folderId, tenantId, organizationId)
      if (!canEditFolder(dest.folder, dest.acl)) {
        throw new CrudHttpError(403, { error: 'Forbidden — destination folder' })
      }
      dashboard.folderId = input.folderId
    }
    dashboard.version = dashboard.version + 1
    dashboard.updatedAt = new Date()
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: dashboard,
      identifiers: { id: dashboard.id, organizationId, tenantId },
      indexer: dashboardIndexer,
      events: dashboardEvents,
    })
    return { dashboardId: dashboard.id }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'Update dashboard',
    resourceKind: 'reports.dashboard',
    resourceId: result.dashboardId,
  }),
}

const deleteDashboardCommand: CommandHandler<DashboardDeleteInput, { dashboardId: string }> = {
  id: 'reports.dashboard.delete',
  async execute(rawInput, ctx) {
    const input = dashboardDeleteSchema.parse(rawInput)
    const { tenantId, organizationId } = requireTenant(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const dashboard = await em.findOne(ReportDashboard, {
      id: input.id,
      tenantId,
      organizationId,
      deletedAt: null,
    } as Record<string, unknown>)
    if (!dashboard) throw new CrudHttpError(404, { error: 'Dashboard not found' })

    const { folder, acl } = await loadAclContext(ctx, em, dashboard.folderId, tenantId, organizationId)
    const perm = resolveArtifactPermission({
      folder,
      artifactOwnerUserId: dashboard.ownerUserId,
      ctx: acl,
    })
    if (perm !== 'edit') throw new CrudHttpError(403, { error: 'Forbidden' })

    dashboard.deletedAt = new Date()
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: dashboard,
      identifiers: { id: dashboard.id, organizationId, tenantId },
      indexer: dashboardIndexer,
      events: dashboardEvents,
    })
    return { dashboardId: dashboard.id }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'Delete dashboard',
    resourceKind: 'reports.dashboard',
    resourceId: result.dashboardId,
  }),
}

const moveDashboardCommand: CommandHandler<DashboardMoveInput, { dashboardId: string }> = {
  id: 'reports.dashboard.move',
  async execute(rawInput, ctx) {
    const input = dashboardMoveSchema.parse(rawInput)
    const { tenantId, organizationId } = requireTenant(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const dashboard = await em.findOne(ReportDashboard, {
      id: input.id,
      tenantId,
      organizationId,
      deletedAt: null,
    } as Record<string, unknown>)
    if (!dashboard) throw new CrudHttpError(404, { error: 'Dashboard not found' })

    const src = await loadAclContext(ctx, em, dashboard.folderId, tenantId, organizationId)
    const srcPerm = resolveArtifactPermission({
      folder: src.folder,
      artifactOwnerUserId: dashboard.ownerUserId,
      ctx: src.acl,
    })
    if (srcPerm !== 'edit') throw new CrudHttpError(403, { error: 'Forbidden — source folder' })

    if (input.folderId !== dashboard.folderId) {
      const dest = await loadAclContext(ctx, em, input.folderId, tenantId, organizationId)
      if (!canEditFolder(dest.folder, dest.acl)) {
        throw new CrudHttpError(403, { error: 'Forbidden — destination folder' })
      }
      dashboard.folderId = input.folderId
      dashboard.version = dashboard.version + 1
      dashboard.updatedAt = new Date()
      await em.flush()
    }

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: dashboard,
      identifiers: { id: dashboard.id, organizationId, tenantId },
      indexer: dashboardIndexer,
      events: dashboardEvents,
    })
    return { dashboardId: dashboard.id }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'Move dashboard',
    resourceKind: 'reports.dashboard',
    resourceId: result.dashboardId,
  }),
}

registerCommand(createDashboardCommand)
registerCommand(updateDashboardCommand)
registerCommand(deleteDashboardCommand)
registerCommand(moveDashboardCommand)

export {
  createDashboardCommand,
  updateDashboardCommand,
  deleteDashboardCommand,
  moveDashboardCommand,
}
