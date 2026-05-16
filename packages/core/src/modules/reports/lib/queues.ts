import { createModuleQueue, type Queue } from '@open-mercato/queue'

/**
 * Queue names used by the reports module's Phase 4 workers.
 *
 * - `reports-schedule-runner`: periodic tick worker. It does not receive
 *   payloads from outside the module — the workflow tick handler pushes
 *   an empty job per minute (see `workers/reports-schedule-runner.ts`).
 * - `reports-schedule-execute`: one job per due schedule. Payload carries
 *   `{ scheduleId, tenantId, organizationId }`.
 * - `reports-async-execute`: ad-hoc async report runs (used when a sync
 *   run would exceed `OM_REPORTS_INMEMORY_CAP`).
 * - `reports-export-build`: writes a finished export artifact to the
 *   attachments module after a schedule or async run.
 */
export const REPORTS_SCHEDULE_RUNNER_QUEUE = 'reports-schedule-runner'
export const REPORTS_SCHEDULE_EXECUTE_QUEUE = 'reports-schedule-execute'
export const REPORTS_ASYNC_EXECUTE_QUEUE = 'reports-async-execute'
export const REPORTS_EXPORT_BUILD_QUEUE = 'reports-export-build'

export type ScheduleExecuteJob = {
  scheduleId: string
  tenantId: string
  organizationId: string
  /** Optional override timestamp the worker can treat as "now" for parameter resolution. */
  runAt?: string
}

export type AsyncExecuteJob = {
  reportId: string
  tenantId: string
  organizationId: string
  /** Resolved parameter values for this run. */
  params?: Record<string, unknown>
  /** When the result should be made available; defaults to `now`. */
  requestedAt?: string
}

export type ExportBuildJob = {
  reportId: string
  tenantId: string
  organizationId: string
  format: 'csv' | 'xlsx' | 'json' | 'xml' | 'markdown'
  /** Schedule that requested this export (optional). */
  scheduleId?: string
  /** Pre-resolved parameter values. */
  params?: Record<string, unknown>
}

const queues = new Map<string, Queue<Record<string, unknown>>>()

function getQueue(name: string, defaultConcurrency: number): Queue<Record<string, unknown>> {
  const existing = queues.get(name)
  if (existing) return existing
  const envConcurrency = Number.parseInt(process.env.REPORTS_QUEUE_CONCURRENCY ?? '', 10)
  const concurrency = Number.isFinite(envConcurrency) && envConcurrency > 0 ? envConcurrency : defaultConcurrency
  const created = createModuleQueue<Record<string, unknown>>(name, { concurrency })
  queues.set(name, created)
  return created
}

export function getScheduleRunnerQueue(): Queue<Record<string, unknown>> {
  return getQueue(REPORTS_SCHEDULE_RUNNER_QUEUE, 1)
}

export function getScheduleExecuteQueue(): Queue<ScheduleExecuteJob> {
  return getQueue(REPORTS_SCHEDULE_EXECUTE_QUEUE, 5) as unknown as Queue<ScheduleExecuteJob>
}

export function getAsyncExecuteQueue(): Queue<AsyncExecuteJob> {
  return getQueue(REPORTS_ASYNC_EXECUTE_QUEUE, 3) as unknown as Queue<AsyncExecuteJob>
}

export function getExportBuildQueue(): Queue<ExportBuildJob> {
  return getQueue(REPORTS_EXPORT_BUILD_QUEUE, 3) as unknown as Queue<ExportBuildJob>
}
