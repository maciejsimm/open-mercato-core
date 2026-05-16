import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { Report } from '../data/entities'
import {
  reportCreateSchema,
  reportDeleteSchema,
  reportMoveSchema,
  reportUpdateSchema,
  type ReportCreateInput,
  type ReportDeleteInput,
  type ReportMoveInput,
  type ReportUpdateInput,
} from '../data/validators'
import { canEditFolder, resolveArtifactPermission } from '../lib/folder-acl'
import {
  buildReportInvalidationTags,
  invalidateReportCache,
  type ReportsCacheService,
} from '../lib/result-cache'
import { loadAclContext, requireTenant } from './shared'

async function invalidateCacheForReport(
  container: { resolve: <T>(name: string) => T },
  report: Report,
): Promise<void> {
  let cache: ReportsCacheService | null = null
  try {
    cache = container.resolve<ReportsCacheService>('cacheService')
  } catch {
    cache = null
  }
  if (!cache) return
  const tags = buildReportInvalidationTags({
    tenantId: report.tenantId,
    reportId: report.id,
    datasetId: report.datasetId,
  })
  await invalidateReportCache(cache, tags)
}

const reportIndexer: CrudIndexerConfig<Report> = {
  entityType: 'reports:report',
}
const reportEvents: CrudEventsConfig<Report> = {
  module: 'reports',
  entity: 'report',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const createReportCommand: CommandHandler<ReportCreateInput, { reportId: string }> = {
  id: 'reports.report.create',
  async execute(rawInput, ctx) {
    const input = reportCreateSchema.parse(rawInput)
    const { tenantId, organizationId, userId } = requireTenant(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { folder, acl } = await loadAclContext(ctx, em, input.folderId, tenantId, organizationId)
    if (!canEditFolder(folder, acl)) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    const report = em.create(Report, {
      organizationId,
      tenantId,
      folderId: input.folderId,
      ownerUserId: userId,
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      datasetId: input.datasetId,
      definitionJson: input.definition,
      parametersJson: input.parameters ?? [],
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(report)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: report,
      identifiers: { id: report.id, organizationId, tenantId },
      indexer: reportIndexer,
      events: reportEvents,
    })
    return { reportId: report.id }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'Create report',
    resourceKind: 'reports.report',
    resourceId: result.reportId,
  }),
}

const updateReportCommand: CommandHandler<ReportUpdateInput, { reportId: string }> = {
  id: 'reports.report.update',
  async execute(rawInput, ctx) {
    const input = reportUpdateSchema.parse(rawInput)
    const { tenantId, organizationId, userId } = requireTenant(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const report = await em.findOne(Report, {
      id: input.id,
      tenantId,
      organizationId,
      deletedAt: null,
    } as Record<string, unknown>)
    if (!report) throw new CrudHttpError(404, { error: 'Report not found' })

    // Optimistic locking: if the caller supplies version, it must match.
    if (input.version !== undefined && report.version !== input.version) {
      throw new CrudHttpError(409, { error: 'Conflict — reload and retry' })
    }

    const { folder, acl } = await loadAclContext(ctx, em, report.folderId, tenantId, organizationId)
    const perm = resolveArtifactPermission({
      folder,
      artifactOwnerUserId: report.ownerUserId,
      ctx: acl,
    })
    if (perm !== 'edit') throw new CrudHttpError(403, { error: 'Forbidden' })

    if (input.name !== undefined) report.name = input.name
    if (input.description !== undefined) report.description = input.description ?? null
    if (input.definition !== undefined) report.definitionJson = input.definition
    if (input.parameters !== undefined) report.parametersJson = input.parameters
    if (input.folderId !== undefined && input.folderId !== report.folderId) {
      // moving folders requires edit on the destination folder
      const dest = await loadAclContext(ctx, em, input.folderId, tenantId, organizationId)
      if (!canEditFolder(dest.folder, dest.acl)) {
        throw new CrudHttpError(403, { error: 'Forbidden — destination folder' })
      }
      report.folderId = input.folderId
    }
    report.version = report.version + 1
    report.updatedAt = new Date()
    void userId
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: report,
      identifiers: { id: report.id, organizationId, tenantId },
      indexer: reportIndexer,
      events: reportEvents,
    })
    await invalidateCacheForReport(ctx.container, report)
    return { reportId: report.id }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'Update report',
    resourceKind: 'reports.report',
    resourceId: result.reportId,
  }),
}

const deleteReportCommand: CommandHandler<ReportDeleteInput, { reportId: string }> = {
  id: 'reports.report.delete',
  async execute(rawInput, ctx) {
    const input = reportDeleteSchema.parse(rawInput)
    const { tenantId, organizationId } = requireTenant(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const report = await em.findOne(Report, {
      id: input.id,
      tenantId,
      organizationId,
      deletedAt: null,
    } as Record<string, unknown>)
    if (!report) throw new CrudHttpError(404, { error: 'Report not found' })

    const { folder, acl } = await loadAclContext(ctx, em, report.folderId, tenantId, organizationId)
    const perm = resolveArtifactPermission({
      folder,
      artifactOwnerUserId: report.ownerUserId,
      ctx: acl,
    })
    if (perm !== 'edit') throw new CrudHttpError(403, { error: 'Forbidden' })

    report.deletedAt = new Date()
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: report,
      identifiers: { id: report.id, organizationId, tenantId },
      indexer: reportIndexer,
      events: reportEvents,
    })
    await invalidateCacheForReport(ctx.container, report)
    return { reportId: report.id }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'Delete report',
    resourceKind: 'reports.report',
    resourceId: result.reportId,
  }),
}

const moveReportCommand: CommandHandler<ReportMoveInput, { reportId: string }> = {
  id: 'reports.report.move',
  async execute(rawInput, ctx) {
    const input = reportMoveSchema.parse(rawInput)
    const { tenantId, organizationId } = requireTenant(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const report = await em.findOne(Report, {
      id: input.id,
      tenantId,
      organizationId,
      deletedAt: null,
    } as Record<string, unknown>)
    if (!report) throw new CrudHttpError(404, { error: 'Report not found' })

    const src = await loadAclContext(ctx, em, report.folderId, tenantId, organizationId)
    const srcPerm = resolveArtifactPermission({
      folder: src.folder,
      artifactOwnerUserId: report.ownerUserId,
      ctx: src.acl,
    })
    if (srcPerm !== 'edit') throw new CrudHttpError(403, { error: 'Forbidden — source folder' })

    if (input.folderId !== report.folderId) {
      const dest = await loadAclContext(ctx, em, input.folderId, tenantId, organizationId)
      if (!canEditFolder(dest.folder, dest.acl)) {
        throw new CrudHttpError(403, { error: 'Forbidden — destination folder' })
      }
      report.folderId = input.folderId
      report.version = report.version + 1
      report.updatedAt = new Date()
      await em.flush()
    }

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: report,
      identifiers: { id: report.id, organizationId, tenantId },
      indexer: reportIndexer,
      events: reportEvents,
    })
    await invalidateCacheForReport(ctx.container, report)
    return { reportId: report.id }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'Move report',
    resourceKind: 'reports.report',
    resourceId: result.reportId,
  }),
}

registerCommand(createReportCommand)
registerCommand(updateReportCommand)
registerCommand(deleteReportCommand)
registerCommand(moveReportCommand)

export { createReportCommand, updateReportCommand, deleteReportCommand, moveReportCommand }
