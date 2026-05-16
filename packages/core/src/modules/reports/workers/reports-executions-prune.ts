import type { EntityManager } from '@mikro-orm/postgresql'
import { ReportExecution } from '../data/entities'
import {
  REPORTS_EXECUTIONS_PRUNE_QUEUE,
  calculateOrphanCutoff,
  calculateRetentionCutoff,
  formatTimeoutError,
  readPruneConfigFromEnv,
  type ReportsPruneRunResult,
} from '../lib/prune'

export const metadata = {
  queue: REPORTS_EXECUTIONS_PRUNE_QUEUE,
  id: 'reports:executions-prune',
  concurrency: 1,
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Daily retention pass over `reports_executions`.
 *
 * Two passes per tick:
 *   1. Delete rows where `started_at < now - retentionDays`.
 *   2. Reap orphan `running` rows whose `started_at` predates
 *      `now - asyncTimeoutMs - 60s` — mark them `failed` instead of
 *      deleting so the schedule UI can still surface the failure.
 *
 * The worker is enqueued by a daily cron-trigger (set up by the user)
 * or via the future Phase 5.4 CLI (`yarn mercato reports prune`). It is
 * deliberately idempotent — invoking it twice in the same minute does
 * nothing harmful because both queries are bounded by the same cutoff
 * timestamps.
 */
export default async function handle(_job: unknown, ctx: HandlerContext): Promise<ReportsPruneRunResult> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const config = readPruneConfigFromEnv()
  const now = new Date()
  const retentionCutoff = calculateRetentionCutoff(now, config.retentionDays)
  const orphanCutoff = calculateOrphanCutoff(now, config.asyncTimeoutMs)

  const prunedCount = await em.nativeDelete(ReportExecution, {
    startedAt: { $lt: retentionCutoff },
  } as Record<string, unknown>)

  const orphanRows = await em.find(ReportExecution, {
    status: 'running',
    startedAt: { $lt: orphanCutoff },
  } as Record<string, unknown>)
  let reapedCount = 0
  if (orphanRows.length > 0) {
    const timeoutMessage = formatTimeoutError(config.asyncTimeoutMs)
    for (const row of orphanRows) {
      row.status = 'failed'
      row.completedAt = now
      row.errorText = timeoutMessage
      reapedCount += 1
    }
    await em.flush()
  }

  if (typeof console !== 'undefined' && (prunedCount > 0 || reapedCount > 0)) {
    console.info('[reports/executions-prune] completed', {
      prunedCount,
      reapedCount,
      retentionCutoff: retentionCutoff.toISOString(),
      orphanCutoff: orphanCutoff.toISOString(),
    })
  }

  return { prunedCount, reapedCount, retentionCutoff, orphanCutoff }
}
