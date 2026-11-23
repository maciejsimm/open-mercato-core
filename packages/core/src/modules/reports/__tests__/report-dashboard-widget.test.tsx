/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: jest.fn(),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

import widgetModule from '../widgets/dashboard/report/widget'
import ReportDashboardWidget from '../widgets/dashboard/report/widget.client'
import {
  hydrateReportWidgetSettings,
  settingsToBindings,
  type ReportWidgetSettings,
} from '../widgets/dashboard/report/config'

const REPORT_ID = '11111111-1111-4111-8111-111111111111'

function props(mode: 'view' | 'settings', settings: ReportWidgetSettings): DashboardWidgetComponentProps<ReportWidgetSettings> {
  return {
    mode,
    layout: { id: 'item-1', widgetId: 'reports.dashboard.report', order: 0 },
    settings,
    context: { userId: 'user-1' },
    onSettingsChange: jest.fn(),
    refreshToken: 0,
  }
}

beforeEach(() => {
  apiCallMock.mockReset()
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/reports/reports?')) {
      return {
        ok: true,
        status: 200,
        result: {
          items: [{ id: REPORT_ID, name: 'Revenue by region', parameters: [{ key: 'region', kind: 'string', labelKey: 'Region' }] }],
        },
      }
    }
    if (url.endsWith('/run')) return { ok: true, status: 200, result: { mode: 'sync', rows: [{ region: 'EMEA', total: 3 }], total: 1 } }
    return { ok: true, status: 200, result: { items: [] } }
  })
})

describe('reports home-dashboard widget', () => {
  it('is gated by reports.view and stays out of default layouts', () => {
    expect(widgetModule.metadata.id).toBe('reports.dashboard.report')
    expect(widgetModule.metadata.features).toEqual(expect.arrayContaining(['dashboards.view', 'reports.view']))
    expect(widgetModule.metadata.defaultEnabled).toBe(false)
  })

  it('hydrates settings defensively and drops empty parameter values', () => {
    expect(hydrateReportWidgetSettings(null)).toEqual({ artifactType: 'report', artifactId: null, params: {}, title: '' })
    const hydrated = hydrateReportWidgetSettings({
      artifactType: 'dashboard',
      artifactId: ` ${REPORT_ID} `,
      params: { region: 'EMEA', empty: '', none: null, list: [] },
      title: 42,
    })
    expect(hydrated).toEqual({ artifactType: 'dashboard', artifactId: REPORT_ID, params: { region: 'EMEA' }, title: '' })
    expect(settingsToBindings(hydrated)).toEqual({ region: { source: 'literal', value: 'EMEA' } })
  })

  it('asks the user to pick an artifact when none is configured', () => {
    renderWithProviders(<ReportDashboardWidget {...props('view', hydrateReportWidgetSettings({}))} />)
    expect(screen.getByText("Pick a report or report dashboard in this widget's settings.")).toBeTruthy()
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('runs the picked report with the fixed parameter values and links to it', async () => {
    const settings = hydrateReportWidgetSettings({ artifactId: REPORT_ID, params: { region: 'EMEA' }, title: 'EMEA revenue' })
    renderWithProviders(<ReportDashboardWidget {...props('view', settings)} />)
    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledWith(
        `/api/reports/reports/${REPORT_ID}/run`,
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ params: { region: 'EMEA' }, mode: 'sync' }) }),
      )
    })
    expect(screen.getByText('EMEA revenue')).toBeTruthy()
    expect(screen.getByText('Open report').closest('a')?.getAttribute('href')).toBe(`/backend/reports/${REPORT_ID}`)
  })

  it('lists viewable reports and the picked report parameters in settings mode', async () => {
    const settings = hydrateReportWidgetSettings({ artifactId: REPORT_ID })
    renderWithProviders(<ReportDashboardWidget {...props('settings', settings)} />)
    await waitFor(() => expect(screen.getByText('Parameter values')).toBeTruthy())
    expect(apiCallMock).toHaveBeenCalledWith('/api/reports/reports?pageSize=100', undefined, expect.anything())
    expect(screen.getByLabelText(/region/i)).toBeTruthy()
  })
})
