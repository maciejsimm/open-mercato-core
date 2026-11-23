/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()
const runMock = jest.fn()
const runMutationMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => runMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: runMutationMock, retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/backend/reports/dashboards/d-1',
  useSearchParams: () => new URLSearchParams(),
}))

import DashboardPage from '../backend/reports/dashboards/[id]/page'

const REPORT_ID = '11111111-1111-4111-8111-111111111111'

function dashboardFixture(permission: 'view' | 'edit') {
  return {
    id: 'd-1',
    name: 'Pipeline',
    description: null,
    folderId: 'f-1',
    permission,
    version: 1,
    lastExecutedAt: null,
    updatedAt: null,
    parameters: [{ key: 'region', kind: 'string', defaultValue: 'EMEA' }],
    layout: {
      grid: { cols: 12, rowHeight: 80, gap: 8 },
      tiles: [
        { id: 'tile_1', reportId: REPORT_ID, x: 0, y: 0, w: 8, h: 4, mode: 'inline', title: 'Revenue A' },
        { id: 'tile_2', reportId: REPORT_ID, x: 8, y: 0, w: 4, h: 4, mode: 'inline', title: 'Revenue B' },
      ],
    },
  }
}

function setup(permission: 'view' | 'edit') {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/reports/dashboards')) return { ok: true, status: 200, result: { items: [dashboardFixture(permission)] } }
    return {
      ok: true,
      status: 200,
      result: {
        items: [{
          id: REPORT_ID,
          name: 'Revenue',
          type: 'flat_list',
          datasetId: 'sales.orders',
          definition: { type: 'flat_list', fields: ['amount'], filters: [], sort: [] },
          parameters: [{ key: 'region', kind: 'string' }],
        }],
      },
    }
  })
  runMock.mockResolvedValue({
    tiles: [
      { tileId: 'tile_1', reportId: REPORT_ID, mode: 'inline', rows: [{ amount: 1234.5 }], total: 1, meta: { columns: [{ key: 'amount', kind: 'float' }] } },
      { tileId: 'tile_2', reportId: REPORT_ID, mode: 'inline', rows: [{ amount: 10 }], total: 1, meta: { columns: [{ key: 'amount', kind: 'float' }] } },
    ],
  })
  return renderWithProviders(<DashboardPage params={{ id: 'd-1' }} />)
}

describe('dashboard view mode (F16)', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    runMock.mockReset()
  })

  it('renders tiles in view mode without a Run click, with the dashboard params and formatted values', async () => {
    setup('view')
    await waitFor(() => expect(runMock).toHaveBeenCalledTimes(1))
    const [url, init] = runMock.mock.calls[0] as [string, { body: string }]
    expect(url).toBe('/api/reports/dashboards/d-1/run')
    expect(JSON.parse(init.body)).toEqual({ params: { region: 'EMEA' } })
    expect(await screen.findByText('1,234.50')).toBeTruthy()
    expect(screen.getByText('Revenue A')).toBeTruthy()
    expect(screen.getByText('Revenue B')).toBeTruthy()
    expect(screen.getAllByText('Open report')).toHaveLength(2)
    expect(screen.queryByText('Edit')).toBeNull()
    expect(screen.queryByText('Add tile')).toBeNull()
  })

  it('lets an editor switch between view and edit', async () => {
    setup('edit')
    fireEvent.click(await screen.findByText('Edit'))
    expect(await screen.findByText('Add tile')).toBeTruthy()
    fireEvent.click(screen.getByText('View'))
    await waitFor(() => expect(screen.queryByText('Add tile')).toBeNull())
  })

  it('re-runs the tiles when a dashboard parameter changes', async () => {
    jest.useFakeTimers()
    try {
      setup('view')
      await act(async () => { await jest.advanceTimersByTimeAsync(10) })
      await waitFor(() => expect(runMock).toHaveBeenCalledTimes(1))
      const input = await screen.findByLabelText('region')
      fireEvent.change(input, { target: { value: 'APAC' } })
      await act(async () => { await jest.advanceTimersByTimeAsync(500) })
      await waitFor(() => expect(runMock).toHaveBeenCalledTimes(2))
      const [, init] = runMock.mock.calls[1] as [string, { body: string }]
      expect(JSON.parse(init.body)).toEqual({ params: { region: 'APAC' } })
    } finally {
      jest.useRealTimers()
    }
  })
})
