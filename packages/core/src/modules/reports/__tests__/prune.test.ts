import {
  calculateOrphanCutoff,
  calculateRetentionCutoff,
  formatTimeoutError,
  readPruneConfigFromEnv,
} from '../lib/prune'

describe('readPruneConfigFromEnv', () => {
  it('uses defaults when env is empty', () => {
    expect(readPruneConfigFromEnv({})).toEqual({
      retentionDays: 30,
      asyncTimeoutMs: 15 * 60_000,
    })
  })

  it('honors numeric overrides', () => {
    expect(
      readPruneConfigFromEnv({
        OM_REPORTS_EXECUTION_RETENTION_DAYS: '7',
        OM_REPORTS_ASYNC_TIMEOUT_MS: '90000',
      }),
    ).toEqual({ retentionDays: 7, asyncTimeoutMs: 90_000 })
  })

  it('falls back to defaults for invalid values', () => {
    expect(
      readPruneConfigFromEnv({
        OM_REPORTS_EXECUTION_RETENTION_DAYS: 'abc',
        OM_REPORTS_ASYNC_TIMEOUT_MS: '-10',
      }),
    ).toEqual({ retentionDays: 30, asyncTimeoutMs: 15 * 60_000 })
  })

  it('floors fractional days and enforces the 1-day floor', () => {
    expect(
      readPruneConfigFromEnv({ OM_REPORTS_EXECUTION_RETENTION_DAYS: '7.9' }),
    ).toEqual({ retentionDays: 7, asyncTimeoutMs: 15 * 60_000 })
    expect(
      readPruneConfigFromEnv({ OM_REPORTS_EXECUTION_RETENTION_DAYS: '0' }),
    ).toEqual({ retentionDays: 30, asyncTimeoutMs: 15 * 60_000 })
  })
})

describe('calculateRetentionCutoff', () => {
  it('subtracts the given number of days from the supplied "now"', () => {
    const now = new Date('2026-05-16T12:00:00.000Z')
    const cutoff = calculateRetentionCutoff(now, 30)
    expect(cutoff.toISOString()).toBe('2026-04-16T12:00:00.000Z')
  })

  it('enforces a minimum of one day', () => {
    const now = new Date('2026-05-16T00:00:00.000Z')
    const cutoff = calculateRetentionCutoff(now, 0)
    expect(cutoff.toISOString()).toBe('2026-05-15T00:00:00.000Z')
  })
})

describe('calculateOrphanCutoff', () => {
  it('subtracts the timeout plus a 60 s grace from "now"', () => {
    const now = new Date('2026-05-16T12:00:00.000Z')
    const cutoff = calculateOrphanCutoff(now, 15 * 60_000)
    expect(cutoff.toISOString()).toBe('2026-05-16T11:44:00.000Z')
  })

  it('clamps negative timeouts to zero', () => {
    const now = new Date('2026-05-16T12:00:00.000Z')
    const cutoff = calculateOrphanCutoff(now, -1)
    expect(cutoff.toISOString()).toBe('2026-05-16T11:59:00.000Z')
  })
})

describe('formatTimeoutError', () => {
  it('renders the timeout in seconds', () => {
    expect(formatTimeoutError(900_000)).toContain('900s')
    expect(formatTimeoutError(15_000)).toContain('15s')
  })
})
