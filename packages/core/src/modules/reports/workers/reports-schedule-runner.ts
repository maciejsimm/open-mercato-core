import type { EntityManager } from '@mikro-orm/postgresql'
import { ReportSchedule } from '../data/entities'
import {
  REPORTS_SCHEDULE_RUNNER_QUEUE,
  getScheduleExecuteQueue,
  type ScheduleExecuteJob,
} from '../lib/queues'

export const metadata = {
  queue: REPORTS_SCHEDULE_RUNNER_QUEUE,
  id: 'reports:schedule-runner',
  concurrency: 1,
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Schedule runner — fires periodically (cron'd by the host scheduler) and
 * looks up enabled schedules whose `next_run_at` is past due. Each due
 * schedule is enqueued into `reports-schedule-execute` for processing.
 *
 * Idempotency: the runner does NOT mutate `next_run_at` itself. The
 * `schedule-execute` worker advances the watermark after running so a
 * retried runner tick simply re-enqueues the same job (which the execute
 * worker dedupes via the `scheduleId + paramsHash` rule from the spec).
 */
export default async function handle(_job: { payload: unknown }, ctx: HandlerContext): Promise<void> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const queue = getScheduleExecuteQueue()
  const now = new Date()

  const due = await em.find(
    ReportSchedule,
    {
      enabled: true,
      deletedAt: null,
      nextRunAt: { $lte: now },
    } as Record<string, unknown>,
    { limit: 200, orderBy: { nextRunAt: 'ASC' } },
  )

  for (const schedule of due) {
    const job: ScheduleExecuteJob = {
      scheduleId: schedule.id,
      tenantId: schedule.tenantId,
      organizationId: schedule.organizationId,
      runAt: now.toISOString(),
    }
    await queue.enqueue(job)
  }
}
