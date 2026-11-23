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
import { isReportsAdmin } from '../lib/folder-acl'
import { canRunReport } from '../lib/report-access'
import type { ReportsAccess } from '../lib/access'
import { loadCommandAccess, requireTenant } from './shared'

type RecipientLike = { type: string }

/**
 * Schedules run as their owner (live ACL). The owner must be able to run
 * the report, and delivering to external email addresses requires
 * `reports.admin` — otherwise any `reports.schedule` holder could mail
 * tenant data outside the organization.
 */
async function assertScheduleAllowed(
  em: EntityManager,
  access: ReportsAccess,
  report: Report,
  recipients: readonly RecipientLike[] | undefined,
): Promise<void> {
  if (!(await canRunReport(em, report, access))) {
    throw new CrudHttpError(403, { error: 'You cannot schedule a report you cannot run', code: 'REPORT_FOLDER_FORBIDDEN' })
  }
  if (recipients?.some((r) => r.type === 'email') && !isReportsAdmin(access.userFeatures)) {
    throw new CrudHttpError(403, {
      error: 'Only reports administrators can deliver schedules to external email addresses',
      code: 'REPORT_SCHEDULE_EXTERNAL_RECIPIENT_FORBIDDEN',
    })
  }
}

/** Owner, or report owner for legacy rows, or reports.admin may change a schedule. */
function canManageSchedule(schedule: ReportSchedule, report: Report | null, access: ReportsAccess): boolean {
  if (isReportsAdmin(access.userFeatures)) return true
  const owner = schedule.ownerUserId ?? report?.ownerUserId ?? null
  return owner === access.userId
}

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
    const access = await loadCommandAccess(ctx, em, tenantId, organizationId)
    await assertScheduleAllowed(em, access, report, input.recipients)

    const schedule = em.create(ReportSchedule, {
      organizationId,
      tenantId,
      ownerUserId: access.userId,
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
    const report = await em.findOne(Report, {
      id: schedule.reportId,
      tenantId,
      organizationId,
      deletedAt: null,
    } as Record<string, unknown>)
    const access = await loadCommandAccess(ctx, em, tenantId, organizationId)
    if (!canManageSchedule(schedule, report, access)) throw new CrudHttpError(403, { error: 'Forbidden' })
    if (report && (input.recipients !== undefined || input.enabled === true)) {
      await assertScheduleAllowed(em, access, report, input.recipients ?? (schedule.recipientsJson as RecipientLike[]))
    }

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
    const report = await em.findOne(Report, {
      id: schedule.reportId,
      tenantId,
      organizationId,
    } as Record<string, unknown>)
    const access = await loadCommandAccess(ctx, em, tenantId, organizationId)
    if (!canManageSchedule(schedule, report, access)) throw new CrudHttpError(403, { error: 'Forbidden' })

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
