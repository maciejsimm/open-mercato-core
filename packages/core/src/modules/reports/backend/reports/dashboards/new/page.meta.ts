// Hidden from the sidebar; reached from the Dashboards list "New dashboard" action.
export const metadata = {
  requireAuth: true,
  requireFeatures: ['reports.author'],
  pageTitle: 'New Dashboard',
  pageTitleKey: 'reports.dashboards.new.pageTitle',
  navHidden: true,
  breadcrumb: [
    { label: 'Reports', labelKey: 'reports.nav.reports', href: '/backend/reports' },
    { label: 'Dashboards', labelKey: 'reports.dashboards.nav.title', href: '/backend/reports/dashboards' },
    { label: 'New Dashboard', labelKey: 'reports.dashboards.new.pageTitle' },
  ],
}
