export const metadata = {
  requireAuth: true,
  requireFeatures: ['reports.author'],
  pageTitle: 'New Report',
  pageTitleKey: 'reports.new.pageTitle',
  hideInNav: true,
  breadcrumb: [
    { label: 'Reports', labelKey: 'reports.nav.reports', href: '/backend/reports' },
    { label: 'New Report', labelKey: 'reports.new.pageTitle' },
  ],
}
