const resolveAccessForUserMock = jest.fn()
const canRunReportMock = jest.fn()
const loadScopedReportMock = jest.fn()
const loadDatasetMock = jest.fn()
const executeReportMock = jest.fn()
const sendEmailMock = jest.fn()
const notifyMock = jest.fn()
const resolveRecipientEmailsMock = jest.fn()

jest.mock('../lib/access', () => ({ resolveAccessForUser: (...a: unknown[]) => resolveAccessForUserMock(...a) }))
jest.mock('../lib/report-access', () => ({
  canRunReport: (...a: unknown[]) => canRunReportMock(...a),
  loadScopedReport: (...a: unknown[]) => loadScopedReportMock(...a),
}))
jest.mock('../lib/datasets-registry', () => ({ loadDataset: (...a: unknown[]) => loadDatasetMock(...a) }))
jest.mock('../lib/execute', () => ({ executeReport: (...a: unknown[]) => executeReportMock(...a) }))
jest.mock('@open-mercato/shared/lib/email/send', () => ({ sendEmail: (...a: unknown[]) => sendEmailMock(...a) }))
jest.mock('../lib/notify', () => ({ notifyReportsUser: (...a: unknown[]) => notifyMock(...a) }))
jest.mock('../lib/recipients', () => ({ resolveRecipientEmails: (...a: unknown[]) => resolveRecipientEmailsMock(...a) }))
jest.mock('../events', () => ({ emitReportsEvent: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ loadDictionary: jest.fn().mockResolvedValue({}) }))
jest.mock('../emails/ScheduledReportEmail', () => ({ ScheduledReportEmail: () => null }))
jest.mock('../data/entities', () => ({ ReportExecution: class ReportExecution {}, ReportSchedule: class ReportSchedule {} }))

import handle, { MAX_SCHEDULE_FAILURES, SCHEDULE_RETRY_BASE_MS, computeRetryAt } from '../workers/reports-schedule-execute'

type ScheduleRow = Record<string, unknown> & { failureCount: number; enabled: boolean; nextRunAt: Date | null }

function makeContext(schedule: ScheduleRow, claimRows = 1) {
  const created: Record<string, unknown>[] = []
  const em = {
    fork: () => em,
    findOne: jest.fn().mockResolvedValue(schedule),
    create: jest.fn((_cls: unknown, data: Record<string, unknown>) => {
      const row = { id: `exec_${created.length + 1}`, ...data }
      created.push(row)
      return row
    }),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    nativeUpdate: jest.fn().mockResolvedValue(claimRows),
  }
  const ctx = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'queryEngine') return {}
      throw new Error(`unexpected resolve ${name}`)
    },
  }
  return { ctx, created, em }
}

function schedule(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    id: 'sch_1',
    reportId: 'rep_1',
    ownerUserId: 'owner_1',
    name: 'Weekly',
    cadence: 'weekly:mon@09:00',
    timezone: 'UTC',
    recipientsJson: [{ type: 'user', userId: 'u2' }],
    paramsJson: {},
    formatsJson: ['csv', 'xlsx'],
    enabled: true,
    failureCount: 0,
    nextRunAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

const job = { payload: { scheduleId: 'sch_1', tenantId: 't1', organizationId: 'o1' } }

describe('F3 — schedules run as the owner with live ACL', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    loadScopedReportMock.mockResolvedValue({ id: 'rep_1', name: 'Revenue', ownerUserId: 'author', datasetId: 'sales.orders', definitionJson: { type: 'flat_list', fields: ['id'], filters: [], sort: [] } })
    resolveAccessForUserMock.mockResolvedValue({ userId: 'owner_1', tenantId: 't1', organizationId: 'o1', userFeatures: new Set(['reports.view', 'sales.view']), roleIds: new Set() })
    loadDatasetMock.mockResolvedValue({ id: 'sales.orders' })
    executeReportMock.mockResolvedValue({ mode: 'sync', rows: [{ id: 'o1' }], total: 1, meta: { duration_ms: 1, truncated: false, cap: 100, fields: ['id'], columns: [{ key: 'id', kind: 'id' }] } })
    resolveRecipientEmailsMock.mockResolvedValue({ emails: ['a@example.com'], droppedExternal: 0 })
    sendEmailMock.mockResolvedValue(undefined)
    canRunReportMock.mockResolvedValue(true)
  })

  test('executes with the owner features (never a wildcard) and emails base64 attachments', async () => {
    const row = schedule()
    const { ctx, created } = makeContext(row)
    await handle(job, ctx)
    expect(resolveAccessForUserMock).toHaveBeenCalledWith(ctx, expect.anything(), 'owner_1', { tenantId: 't1', organizationId: 'o1' })
    const execInput = executeReportMock.mock.calls[0][1]
    expect(Array.from(execInput.userFeatures)).toEqual(['reports.view', 'sales.view'])
    expect(execInput.userId).toBe('owner_1')
    expect(execInput.readAllPages).toBe(true)
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const attachments = sendEmailMock.mock.calls[0][0].attachments as Array<{ filename: string; content: string }>
    expect(attachments.map((a) => a.filename)).toEqual(['Revenue.csv', 'Revenue.xlsx'])
    expect(Buffer.from(attachments[0].content, 'base64').toString('utf8')).toContain('o1')
    expect(resolveRecipientEmailsMock.mock.calls[0][3]).toEqual({ allowExternal: false })
    expect(created[0]).toMatchObject({ status: 'completed', requestedByUserId: 'owner_1' })
    expect(row.failureCount).toBe(0)
  })

  test('legacy schedules without an owner run as the report owner', async () => {
    const { ctx } = makeContext(schedule({ ownerUserId: null }))
    await handle(job, ctx)
    expect(resolveAccessForUserMock.mock.calls[0][2]).toBe('author')
  })

  test('owner lost access → fails closed, counts the failure, no email', async () => {
    canRunReportMock.mockResolvedValue(false)
    const row = schedule()
    const { ctx, created } = makeContext(row)
    await handle(job, ctx)
    expect(executeReportMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(row.failureCount).toBe(1)
    expect(created[0]).toMatchObject({ status: 'failed', errorText: 'report_access_denied' })
    expect(notifyMock).not.toHaveBeenCalled()
  })

  test(`after ${MAX_SCHEDULE_FAILURES} failures the schedule is disabled and the owner notified`, async () => {
    canRunReportMock.mockResolvedValue(false)
    const row = schedule({ failureCount: MAX_SCHEDULE_FAILURES - 1 })
    const { ctx } = makeContext(row)
    await handle(job, ctx)
    expect(row.enabled).toBe(false)
    expect(row.nextRunAt).toBeNull()
    expect(notifyMock).toHaveBeenCalledWith(ctx, 'reports.schedule_failed', expect.objectContaining({ recipientUserId: 'owner_1' }), { tenantId: 't1', organizationId: 'o1' })
  })

  test('external recipients are allowed only for reports.admin owners', async () => {
    canRunReportMock.mockResolvedValue(true)
    resolveAccessForUserMock.mockResolvedValue({ userId: 'owner_1', tenantId: 't1', organizationId: 'o1', userFeatures: new Set(['reports.*']), roleIds: new Set() })
    const { ctx } = makeContext(schedule())
    await handle(job, ctx)
    expect(resolveRecipientEmailsMock.mock.calls[0][3]).toEqual({ allowExternal: true })
  })

  test('a run whose claim is lost (concurrent worker) does nothing', async () => {
    const row = schedule()
    const { ctx, created } = makeContext(row, 0)
    await handle(job, ctx)
    expect(created).toHaveLength(0)
    expect(executeReportMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  test('the claim compares against the next_run_at value that was read', async () => {
    const row = schedule()
    const original = row.nextRunAt
    const { ctx, em } = makeContext(row)
    await handle(job, ctx)
    expect(em.nativeUpdate.mock.calls[0][1]).toMatchObject({ id: 'sch_1', nextRunAt: original })
  })

  test('a failed run is retried with backoff instead of on the next tick', async () => {
    canRunReportMock.mockResolvedValue(false)
    const row = schedule()
    const { ctx } = makeContext(row)
    const before = Date.now()
    await handle(job, ctx)
    expect(row.enabled).toBe(true)
    expect(row.nextRunAt?.getTime() ?? 0).toBeGreaterThanOrEqual(before + SCHEDULE_RETRY_BASE_MS - 1000)
  })
})

describe('computeRetryAt', () => {
  const now = new Date('2026-01-01T00:00:00Z')
  test('doubles per consecutive failure', () => {
    expect(computeRetryAt(now, 1, null).getTime() - now.getTime()).toBe(SCHEDULE_RETRY_BASE_MS)
    expect(computeRetryAt(now, 2, null).getTime() - now.getTime()).toBe(2 * SCHEDULE_RETRY_BASE_MS)
  })
  test('never later than the next regular run', () => {
    const regular = new Date(now.getTime() + 60_000)
    expect(computeRetryAt(now, 2, regular)).toEqual(regular)
  })
})
