import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { ReportFolder, ReportFolderShare } from '../data/entities'
import {
  folderCreateSchema,
  folderDeleteSchema,
  folderShareCreateSchema,
  folderShareDeleteSchema,
  folderUpdateSchema,
  type FolderCreateInput,
  type FolderDeleteInput,
  type FolderShareCreateInput,
  type FolderShareDeleteInput,
  type FolderUpdateInput,
} from '../data/validators'
import { canEditFolder, canShareFolder, canViewFolder, isReportsAdmin } from '../lib/folder-acl'
import { loadAclContext, loadCommandAccess, loadFolderRecord, requireTenant } from './shared'

const folderIndexer: CrudIndexerConfig<ReportFolder> = {
  entityType: 'reports:folder',
}
const folderEvents: CrudEventsConfig<ReportFolder> = {
  module: 'reports',
  entity: 'folder',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const shareIndexer: CrudIndexerConfig<ReportFolderShare> = {
  entityType: 'reports:folder_share',
}
const shareEvents: CrudEventsConfig<ReportFolderShare> = {
  module: 'reports',
  entity: 'folder',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const createFolderCommand: CommandHandler<FolderCreateInput, { folderId: string }> = {
  id: 'reports.folder.create',
  async execute(rawInput, ctx) {
    const input = folderCreateSchema.parse(rawInput)
    const { tenantId, organizationId, userId } = requireTenant(ctx)
    if (input.kind === 'private') {
      // private folder always owned by the creator
    } else {
      // creating public top-level folders requires reports.admin
      const access = await loadCommandAccess(ctx, (ctx.container.resolve('em') as EntityManager).fork(), tenantId, organizationId)
      if (!isReportsAdmin(access.userFeatures)) {
        throw new CrudHttpError(403, { error: 'Only reports.admin can create public folders' })
      }
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const folder = em.create(ReportFolder, {
      organizationId,
      tenantId,
      parentFolderId: input.parentFolderId ?? null,
      ownerUserId: input.kind === 'private' ? userId : null,
      kind: input.kind,
      name: input.name,
      position: input.position ?? 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(folder)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: folder,
      identifiers: { id: folder.id, organizationId, tenantId },
      indexer: folderIndexer,
      events: folderEvents,
    })
    return { folderId: folder.id }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'Create folder',
    resourceKind: 'reports.folder',
    resourceId: result.folderId,
  }),
}

const updateFolderCommand: CommandHandler<FolderUpdateInput, { folderId: string }> = {
  id: 'reports.folder.update',
  async execute(rawInput, ctx) {
    const input = folderUpdateSchema.parse(rawInput)
    const { tenantId, organizationId } = requireTenant(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const folder = await em.findOne(ReportFolder, {
      id: input.id,
      tenantId,
      organizationId,
      deletedAt: null,
    } as Record<string, unknown>)
    if (!folder) throw new CrudHttpError(404, { error: 'Folder not found' })
    const { acl } = await loadAclContext(ctx, em, folder.id, tenantId, organizationId)
    if (!canEditFolder(
      { id: folder.id, kind: folder.kind, ownerUserId: folder.ownerUserId ?? null, organizationId, tenantId },
      acl,
    )) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    if (input.name !== undefined) folder.name = input.name
    if (input.parentFolderId !== undefined) folder.parentFolderId = input.parentFolderId
    if (input.position !== undefined) folder.position = input.position
    folder.updatedAt = new Date()
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: folder,
      identifiers: { id: folder.id, organizationId, tenantId },
      indexer: folderIndexer,
      events: folderEvents,
    })
    return { folderId: folder.id }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'Update folder',
    resourceKind: 'reports.folder',
    resourceId: result.folderId,
  }),
}

const deleteFolderCommand: CommandHandler<FolderDeleteInput, { folderId: string }> = {
  id: 'reports.folder.delete',
  async execute(rawInput, ctx) {
    const input = folderDeleteSchema.parse(rawInput)
    const { tenantId, organizationId } = requireTenant(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const folder = await em.findOne(ReportFolder, {
      id: input.id,
      tenantId,
      organizationId,
      deletedAt: null,
    } as Record<string, unknown>)
    if (!folder) throw new CrudHttpError(404, { error: 'Folder not found' })
    const { acl } = await loadAclContext(ctx, em, folder.id, tenantId, organizationId)
    if (!canEditFolder(
      { id: folder.id, kind: folder.kind, ownerUserId: folder.ownerUserId ?? null, organizationId, tenantId },
      acl,
    )) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    folder.deletedAt = new Date()
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: folder,
      identifiers: { id: folder.id, organizationId, tenantId },
      indexer: folderIndexer,
      events: folderEvents,
    })
    return { folderId: folder.id }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'Delete folder',
    resourceKind: 'reports.folder',
    resourceId: result.folderId,
  }),
}

const createFolderShareCommand: CommandHandler<FolderShareCreateInput, { shareId: string }> = {
  id: 'reports.folder.share',
  async execute(rawInput, ctx) {
    const input = folderShareCreateSchema.parse(rawInput)
    const { tenantId, organizationId } = requireTenant(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const folder = await loadFolderRecord(em, input.folderId, tenantId, organizationId)
    if (!folder) throw new CrudHttpError(404, { error: 'Folder not found' })
    if (folder.kind === 'public') {
      throw new CrudHttpError(400, { error: 'Public folders cannot be shared' })
    }
    const { acl } = await loadAclContext(ctx, em, folder.id, tenantId, organizationId)
    if (!canShareFolder(folder, acl)) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    const share = em.create(ReportFolderShare, {
      organizationId,
      tenantId,
      folderId: folder.id,
      principalType: input.principalType,
      principalId: input.principalId,
      permission: input.permission,
      grantedByUserId: ctx.auth?.sub ?? '',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(share)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: share,
      identifiers: { id: share.id, organizationId, tenantId },
      indexer: shareIndexer,
      events: shareEvents,
    })
    return { shareId: share.id }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'Share folder',
    resourceKind: 'reports.folder_share',
    resourceId: result.shareId,
  }),
}

const deleteFolderShareCommand: CommandHandler<FolderShareDeleteInput, { shareId: string }> = {
  id: 'reports.folder.share.delete',
  async execute(rawInput, ctx) {
    const input = folderShareDeleteSchema.parse(rawInput)
    const { tenantId, organizationId } = requireTenant(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const share = await em.findOne(ReportFolderShare, {
      id: input.id,
      tenantId,
      organizationId,
    } as Record<string, unknown>)
    if (!share) throw new CrudHttpError(404, { error: 'Share not found' })
    const { acl, folder } = await loadAclContext(ctx, em, share.folderId, tenantId, organizationId)
    if (!canShareFolder(folder, acl)) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    await em.remove(share).flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: share,
      identifiers: { id: share.id, organizationId, tenantId },
      indexer: shareIndexer,
      events: shareEvents,
    })
    return { shareId: share.id }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'Remove folder share',
    resourceKind: 'reports.folder_share',
    resourceId: result.shareId,
  }),
}

registerCommand(createFolderCommand)
registerCommand(updateFolderCommand)
registerCommand(deleteFolderCommand)
registerCommand(createFolderShareCommand)
registerCommand(deleteFolderShareCommand)

// Re-export to keep imports stable
export {
  createFolderCommand,
  updateFolderCommand,
  deleteFolderCommand,
  createFolderShareCommand,
  deleteFolderShareCommand,
}

// Silence "canViewFolder unused" tree-shaking warnings when this module is bundled
// without the API consumer; the helper is exported so test setups can re-use it.
void canViewFolder
