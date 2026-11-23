import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import {
  DEFAULT_SETTINGS,
  dehydrateReportWidgetSettings,
  hydrateReportWidgetSettings,
  type ReportWidgetSettings,
} from './config'

const ReportDashboardWidget = lazyDashboardWidget(() => import('./widget.client'))

/**
 * Home-dashboard "Report" widget: renders a saved report or report dashboard
 * the user can view, with fixed parameter values picked in the widget
 * settings. No `reports_embeds` row is involved; the layout item stores the
 * settings and the run routes enforce artifact and field access.
 */
const widget: DashboardWidgetModule<ReportWidgetSettings> = {
  metadata: {
    id: 'reports.dashboard.report',
    title: 'Report',
    description: 'Show a saved report or report dashboard on your home screen.',
    features: ['dashboards.view', 'reports.view'],
    defaultSize: 'md',
    defaultEnabled: false,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['reports'],
    category: 'reports',
    icon: 'bar-chart',
    supportsRefresh: true,
  },
  Widget: ReportDashboardWidget,
  hydrateSettings: hydrateReportWidgetSettings,
  dehydrateSettings: dehydrateReportWidgetSettings,
}

export default widget
