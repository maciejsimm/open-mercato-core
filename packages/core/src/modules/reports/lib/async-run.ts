import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Report, ReportExecution } from '../data/entities'
import type { ReportsAccess } from './access'
import { getAsyncExecuteQueue } from './queues'

export function hashParams(params: Record<string, unknown> | undefined): string {
  const entries = Object.entries(params ?? {}).sort(([a], [b]) => a.localeCompare(b))
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 32)
}

/**
 * Record a `running` execution for the requesting user and enqueue the async
 * worker. The worker re-resolves the requester's live ACL before running.
 */
export async function dispatchAsyncRun(input: {
  em: EntityManager
  report: Report
  access: ReportsAccess
  params: Record<string, unknown>
}): Promise<string> {
  const execution = input.em.create(ReportExecution, {
    organizationId: input.access.organizationId,
    tenantId: input.access.tenantId,
    reportId: input.report.id,
    requestedByUserId: input.access.userId,
    paramsHash: hashParams(input.params),
    status: 'running',
    startedAt: new Date(),
    createdAt: new Date(),
  })
  input.em.persist(execution)
  await input.em.flush()
  await getAsyncExecuteQueue().enqueue({
    executionId: execution.id,
    requestedByUserId: input.access.userId,
    reportId: input.report.id,
    tenantId: input.access.tenantId,
    organizationId: input.access.organizationId,
    params: input.params,
    requestedAt: new Date().toISOString(),
  })
  return execution.id
}
