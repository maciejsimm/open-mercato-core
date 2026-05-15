export const metadata = {
  requireAuth: true,
  requireFeatures: ['reports.view'],
  pageTitle: 'Report',
  pageTitleKey: 'reports.detail.pageTitle',
  hideInNav: true,
  breadcrumb: [
    { label: 'Reports', labelKey: 'reports.nav.reports', href: '/backend/reports' },
    { label: 'Report', labelKey: 'reports.detail.pageTitle' },
  ],
}
