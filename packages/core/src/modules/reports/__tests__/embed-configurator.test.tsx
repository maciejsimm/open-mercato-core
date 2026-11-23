/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()
const runMutationMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: runMutationMock, retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('../widgets/injection/record-embed-host/widget.client', () => ({
  EmbedCard: () => <div data-testid="embed-preview" />,
}))

const EMBED_ID = '22222222-2222-4222-8222-222222222222'
const REPORT_ID = '11111111-1111-4111-8111-111111111111'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams({ id: '22222222-2222-4222-8222-222222222222' }),
}))

import EmbedConfiguratorPage from '../backend/reports/embeds/new/page'

function setup(paramBindings: Record<string, unknown>) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/reports/reports')) {
      return {
        ok: true,
        status: 200,
        result: {
          items: [{
            id: REPORT_ID,
            name: 'Open deals',
            parameters: [
              { key: 'region', kind: 'string', required: true },
              { key: 'note', kind: 'string' },
            ],
          }],
        },
      }
    }
    if (url.startsWith('/api/reports/dashboards')) return { ok: true, status: 200, result: { items: [] } }
    if (url.startsWith('/api/reports/embeds')) {
      return {
        ok: true,
        status: 200,
        result: {
          items: [{
            id: EMBED_ID,
            hostSpotId: 'detail:customers.company:after-header',
            artifactType: 'report',
            artifactId: REPORT_ID,
            paramBindings,
            displayTitle: null,
            position: 0,
            enabled: true,
            updatedAt: null,
          }],
        },
      }
    }
    return { ok: true, status: 200, result: { items: [] } }
  })
  return renderWithProviders(<EmbedConfiguratorPage />)
}

describe('embed configurator (F17)', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    runMutationMock.mockReset()
  })

  it('blocks save while a required parameter is unbound', async () => {
    setup({})
    expect(await screen.findByText("Required parameter 'region' has no binding")).toBeTruthy()
    const save = screen.getByText('Save embed').closest('button') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(runMutationMock).not.toHaveBeenCalled()
  })

  it('saves once every required parameter is bound', async () => {
    runMutationMock.mockResolvedValue({ ok: true })
    setup({ region: { source: 'literal', value: 'EMEA' } })
    await screen.findByText('Customer — company')
    const save = (await screen.findByText('Save embed')).closest('button') as HTMLButtonElement
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(runMutationMock).toHaveBeenCalledTimes(1))
    const call = runMutationMock.mock.calls[0][0] as { mutationPayload: Record<string, unknown> }
    expect(call.mutationPayload).toEqual(expect.objectContaining({
      id: EMBED_ID,
      hostSpotId: 'detail:customers.company:after-header',
      hostEntityId: 'customers.company',
      paramBindings: { region: { source: 'literal', value: 'EMEA' } },
    }))
  })
})
