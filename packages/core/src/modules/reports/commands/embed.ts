import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Report, ReportDashboard, ReportEmbed } from '../data/entities'
import {
  embedCreateSchema,
  embedDeleteSchema,
  embedUpdateSchema,
  type EmbedCreateInput,
  type EmbedDeleteInput,
  type EmbedUpdateInput,
} from '../data/validators'
import { requireTenant } from './shared'
import {
  getEmbedHostSpot,
  readParameterDefs,
  validateEmbedConfig,
  type EmbedBindings,
} from '../lib/embed-spots'

const embedIndexer: CrudIndexerConfig<ReportEmbed> = {
  entityType: 'reports:embed',
}
const embedEvents: CrudEventsConfig<ReportEmbed> = {
  module: 'reports',
  entity: 'embed',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type EmbedTarget = {
  hostSpotId: string
  hostEntityId?: string | null
  artifactType: 'report' | 'dashboard'
  artifactId: string
  paramBindings: EmbedBindings
}

/**
 * Reject embeds that could never render: a spot outside the host-spot
 * registry, an artifact missing from the caller's scope, or bindings that do
 * not match the artifact's declared parameters. Returns the host entity id
 * derived from the spot.
 */
export async function assertValidEmbedTarget(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  target: EmbedTarget,
): Promise<string> {
  const where = { id: target.artifactId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }
  const artifact = target.artifactType === 'dashboard'
    ? await findOneWithDecryption(em, ReportDashboard, where as Record<string, unknown>, undefined, scope)
    : await findOneWithDecryption(em, Report, where as Record<string, unknown>, undefined, scope)
  if (!artifact) {
    throw new CrudHttpError(400, {
      error: 'Embedded artifact not found',
      code: 'EMBED_ARTIFACT_NOT_FOUND',
      fieldErrors: { artifactId: 'Embedded artifact not found' },
    })
  }
  const issues = validateEmbedConfig({
    hostSpotId: target.hostSpotId,
    hostEntityId: target.hostEntityId,
    paramBindings: target.paramBindings,
    parameters: readParameterDefs(artifact.parametersJson),
  })
  if (issues.length > 0) {
    throw new CrudHttpError(400, {
      error: issues[0].message,
      code: 'EMBED_INVALID',
      issues,
      fieldErrors: Object.fromEntries(issues.map((issue) => [issue.path, issue.message])),
    })
  }
  const spot = getEmbedHostSpot(target.hostSpotId)
  return spot ? spot.hostEntityId : (target.hostEntityId ?? '')
}

const createEmbedCommand: CommandHandler<EmbedCreateInput, { embedId: string }> = {
  id: 'reports.embed.create',
  async execute(rawInput, ctx) {
    const input = embedCreateSchema.parse(rawInput)
    const { tenantId, organizationId } = requireTenant(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const hostEntityId = await assertValidEmbedTarget(em, { tenantId, organizationId }, {
      hostSpotId: input.hostSpotId,
      hostEntityId: input.hostEntityId,
      artifactType: input.artifactType,
      artifactId: input.artifactId,
      paramBindings: input.paramBindings ?? {},
    })

    const embed = em.create(ReportEmbed, {
      organizationId,
      tenantId,
      hostSpotId: input.hostSpotId,
      hostEntityId,
      artifactType: input.artifactType,
      artifactId: input.artifactId,
      paramBindingsJson: input.paramBindings ?? {},
      displayTitle: input.displayTitle ?? null,
      position: input.position ?? 0,
      enabled: input.enabled ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(embed)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: embed,
      identifiers: { id: embed.id, organizationId, tenantId },
      indexer: embedIndexer,
      events: embedEvents,
    })
    return { embedId: embed.id }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'Create embed',
    resourceKind: 'reports.embed',
    resourceId: result.embedId,
  }),
}

const updateEmbedCommand: CommandHandler<EmbedUpdateInput, { embedId: string }> = {
  id: 'reports.embed.update',
  async execute(rawInput, ctx) {
    const input = embedUpdateSchema.parse(rawInput)
    const { tenantId, organizationId } = requireTenant(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const embed = await em.findOne(ReportEmbed, {
      id: input.id,
      tenantId,
      organizationId,
      deletedAt: null,
    } as Record<string, unknown>)
    if (!embed) throw new CrudHttpError(404, { error: 'Embed not found' })

    const touchesTarget = input.hostSpotId !== undefined
      || input.hostEntityId !== undefined
      || input.artifactType !== undefined
      || input.artifactId !== undefined
      || input.paramBindings !== undefined
    if (touchesTarget) {
      const nextSpotId = input.hostSpotId ?? embed.hostSpotId
      const hostEntityId = await assertValidEmbedTarget(em, { tenantId, organizationId }, {
        hostSpotId: nextSpotId,
        hostEntityId: input.hostEntityId ?? (input.hostSpotId !== undefined ? undefined : embed.hostEntityId),
        artifactType: input.artifactType ?? embed.artifactType,
        artifactId: input.artifactId ?? embed.artifactId,
        paramBindings: input.paramBindings ?? (embed.paramBindingsJson as EmbedBindings | null) ?? {},
      })
      embed.hostSpotId = nextSpotId
      embed.hostEntityId = hostEntityId
      if (input.artifactType !== undefined) embed.artifactType = input.artifactType
      if (input.artifactId !== undefined) embed.artifactId = input.artifactId
      if (input.paramBindings !== undefined) embed.paramBindingsJson = input.paramBindings
    }
    if (input.displayTitle !== undefined) embed.displayTitle = input.displayTitle ?? null
    if (input.position !== undefined) embed.position = input.position
    if (input.enabled !== undefined) embed.enabled = input.enabled
    embed.updatedAt = new Date()
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: embed,
      identifiers: { id: embed.id, organizationId, tenantId },
      indexer: embedIndexer,
      events: embedEvents,
    })
    return { embedId: embed.id }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'Update embed',
    resourceKind: 'reports.embed',
    resourceId: result.embedId,
  }),
}

const deleteEmbedCommand: CommandHandler<EmbedDeleteInput, { embedId: string }> = {
  id: 'reports.embed.delete',
  async execute(rawInput, ctx) {
    const input = embedDeleteSchema.parse(rawInput)
    const { tenantId, organizationId } = requireTenant(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const embed = await em.findOne(ReportEmbed, {
      id: input.id,
      tenantId,
      organizationId,
      deletedAt: null,
    } as Record<string, unknown>)
    if (!embed) throw new CrudHttpError(404, { error: 'Embed not found' })

    embed.deletedAt = new Date()
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: embed,
      identifiers: { id: embed.id, organizationId, tenantId },
      indexer: embedIndexer,
      events: embedEvents,
    })
    return { embedId: embed.id }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'Delete embed',
    resourceKind: 'reports.embed',
    resourceId: result.embedId,
  }),
}

registerCommand(createEmbedCommand)
registerCommand(updateEmbedCommand)
registerCommand(deleteEmbedCommand)

export { createEmbedCommand, updateEmbedCommand, deleteEmbedCommand }
