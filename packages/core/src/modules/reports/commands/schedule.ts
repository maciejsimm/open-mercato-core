import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { Report, ReportSchedule } from '../data/entities'
import {
  scheduleCreateSchema,
  scheduleDeleteSchema,
  scheduleUpdateSchema,
  type ScheduleCreateInput,
  type ScheduleDeleteInput,
  type ScheduleUpdateInput,
} from '../data/validators'
import { parseCadence, computeNextRunAt } from '../lib/schedule-cadence'
import { requireTenant } from './shared'

const scheduleIndexer: CrudIndexerConfig<ReportSchedule> = { entityType: 'reports:schedule' }
const scheduleEvents: CrudEventsConfig<ReportSchedule> = {
  module: 'reports',
  entity: 'schedule',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

function nextRunFor(cadenceRaw: string, timezone: string, now: Date): Date | null {
  const parsed = parseCadence(cadenceRaw)
  if (!parsed) return null
  return computeNextRunAt(parsed, now, timezone)
}

const createScheduleCommand: CommandHandler<ScheduleCreateInput, { scheduleId: string }> = {
  id: 'reports.schedule.create',
  async execute(rawInput, ctx) {
    const input = scheduleCreateSchema.parse(rawInput)
    const { tenantId, organizationId } = requireTenant(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const report = await em.findOne(Report, {
      id: input.reportId,
      tenantId,
      organizationId,
      deletedAt: null,
    } as Record<string, unknown>)
    if (!report) throw new CrudHttpError(404, { error: 'Report not found' })

    const schedule = em.create(ReportSchedule, {
      organizationId,
      tenantId,
      reportId: input.reportId,
      name: input.name,
      cadence: input.cadence,
      timezone: input.timezone,
      recipientsJson: input.recipients as unknown,
      paramsJson: (input.params ?? {}) as unknown,
      formatsJson: (input.formats ?? ['csv']) as unknown,
      enabled: input.enabled ?? true,
      failureCount: 0,
      nextRunAt: nextRunFor(input.cadence, input.timezone, new Date()) ?? undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(schedule)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: schedule,
      identifiers: { id: schedule.id, organizationId, tenantId },
      indexer: scheduleIndexer,
      events: scheduleEvents,
    })
    return { scheduleId: schedule.id }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'Create schedule',
    resourceKind: 'reports.schedule',
    resourceId: result.scheduleId,
  }),
}

const updateScheduleCommand: CommandHandler<ScheduleUpdateInput, { scheduleId: string }> = {
  id: 'reports.schedule.update',
  async execute(rawInput, ctx) {
    const input = scheduleUpdateSchema.parse(rawInput)
    const { tenantId, organizationId } = requireTenant(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const schedule = await em.findOne(ReportSchedule, {
      id: input.id,
      tenantId,
      organizationId,
      deletedAt: null,
    } as Record<string, unknown>)
    if (!schedule) throw new CrudHttpError(404, { error: 'Schedule not found' })

    let cadenceChanged = false
    if (input.name !== undefined) schedule.name = input.name
    if (input.cadence !== undefined && input.cadence !== schedule.cadence) {
      schedule.cadence = input.cadence
      cadenceChanged = true
    }
    if (input.timezone !== undefined && input.timezone !== schedule.timezone) {
      schedule.timezone = input.timezone
      cadenceChanged = true
    }
    if (input.recipients !== undefined) schedule.recipientsJson = input.recipients
    if (input.params !== undefined) schedule.paramsJson = input.params
    if (input.formats !== undefined) schedule.formatsJson = input.formats
    if (input.enabled !== undefined) {
      schedule.enabled = input.enabled
      if (input.enabled && schedule.nextRunAt == null) cadenceChanged = true
    }
    if (cadenceChanged) {
      schedule.nextRunAt = schedule.enabled ? nextRunFor(schedule.cadence, schedule.timezone, new Date()) : null
      schedule.failureCount = 0
    }
    schedule.updatedAt = new Date()
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: schedule,
      identifiers: { id: schedule.id, organizationId, tenantId },
      indexer: scheduleIndexer,
      events: scheduleEvents,
    })
    return { scheduleId: schedule.id }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'Update schedule',
    resourceKind: 'reports.schedule',
    resourceId: result.scheduleId,
  }),
}

const deleteScheduleCommand: CommandHandler<ScheduleDeleteInput, { scheduleId: string }> = {
  id: 'reports.schedule.delete',
  async execute(rawInput, ctx) {
    const input = scheduleDeleteSchema.parse(rawInput)
    const { tenantId, organizationId } = requireTenant(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const schedule = await em.findOne(ReportSchedule, {
      id: input.id,
      tenantId,
      organizationId,
      deletedAt: null,
    } as Record<string, unknown>)
    if (!schedule) throw new CrudHttpError(404, { error: 'Schedule not found' })

    schedule.deletedAt = new Date()
    schedule.enabled = false
    schedule.nextRunAt = null
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: schedule,
      identifiers: { id: schedule.id, organizationId, tenantId },
      indexer: scheduleIndexer,
      events: scheduleEvents,
    })
    return { scheduleId: schedule.id }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'Delete schedule',
    resourceKind: 'reports.schedule',
    resourceId: result.scheduleId,
  }),
}

registerCommand(createScheduleCommand)
registerCommand(updateScheduleCommand)
registerCommand(deleteScheduleCommand)

export { createScheduleCommand, updateScheduleCommand, deleteScheduleCommand }
