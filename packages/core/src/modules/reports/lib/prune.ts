/**
 * Pure helpers for the `reports-executions-prune` retention worker.
 *
 * Worker reads two knobs from env:
 *   - OM_REPORTS_EXECUTION_RETENTION_DAYS (default 30)
 *   - OM_REPORTS_ASYNC_TIMEOUT_MS (default 15 min)
 *
 * The worker performs three deletions per tick:
 *   1. Delete `reports_executions` rows where `started_at <
 *      now - retentionDays` regardless of status.
 *   2. Reap orphan `running` rows where `started_at <
 *      now - (asyncTimeoutMs + 60 s)` — mark them `failed` with an
 *      error message naming the timeout.
 *   3. (Optional) Audit: count rows still running so observability can
 *      report a metric.
 */

export const REPORTS_EXECUTIONS_PRUNE_QUEUE = 'reports-executions-prune'

const DEFAULT_RETENTION_DAYS = 30
const DEFAULT_ASYNC_TIMEOUT_MS = 15 * 60_000
const ORPHAN_GRACE_MS = 60_000
const MIN_RETENTION_DAYS = 1

export type ReportsPruneConfig = {
  retentionDays: number
  asyncTimeoutMs: number
}

export function readPruneConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ReportsPruneConfig {
  const retentionRaw = env.OM_REPORTS_EXECUTION_RETENTION_DAYS
  const retentionParsed = retentionRaw === undefined ? NaN : Number(retentionRaw)
  const retentionDays = Number.isFinite(retentionParsed) && retentionParsed >= MIN_RETENTION_DAYS
    ? Math.floor(retentionParsed)
    : DEFAULT_RETENTION_DAYS

  const timeoutRaw = env.OM_REPORTS_ASYNC_TIMEOUT_MS
  const timeoutParsed = timeoutRaw === undefined ? NaN : Number(timeoutRaw)
  const asyncTimeoutMs = Number.isFinite(timeoutParsed) && timeoutParsed > 0
    ? Math.floor(timeoutParsed)
    : DEFAULT_ASYNC_TIMEOUT_MS

  return { retentionDays, asyncTimeoutMs }
}

export function calculateRetentionCutoff(now: Date, retentionDays: number): Date {
  const cutoff = new Date(now.getTime())
  cutoff.setUTCDate(cutoff.getUTCDate() - Math.max(1, Math.floor(retentionDays)))
  return cutoff
}

export function calculateOrphanCutoff(now: Date, asyncTimeoutMs: number): Date {
  return new Date(now.getTime() - Math.max(0, Math.floor(asyncTimeoutMs)) - ORPHAN_GRACE_MS)
}

export function formatTimeoutError(asyncTimeoutMs: number): string {
  const seconds = Math.round(asyncTimeoutMs / 1000)
  return `Execution timed out after ${seconds}s (no completion before the async timeout window).`
}

export type ReportsPruneRunResult = {
  prunedCount: number
  reapedCount: number
  retentionCutoff: Date
  orphanCutoff: Date
}
