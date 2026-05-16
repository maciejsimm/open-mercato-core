export const metadata = {
  requireAuth: true,
  requireFeatures: ['reports.view'],
  pageTitle: 'Dashboard',
  pageTitleKey: 'reports.dashboards.detail.pageTitle',
  hideInNav: true,
  breadcrumb: [
    { label: 'Reports', labelKey: 'reports.nav.reports', href: '/backend/reports' },
    { label: 'Dashboards', labelKey: 'reports.dashboards.nav.title', href: '/backend/reports/dashboards' },
    { label: 'Dashboard', labelKey: 'reports.dashboards.detail.pageTitle' },
  ],
}
