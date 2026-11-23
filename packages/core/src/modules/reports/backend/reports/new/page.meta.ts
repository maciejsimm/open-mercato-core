// Hidden from the sidebar; reached from the Reports list "New report" action.
export const metadata = {
  requireAuth: true,
  requireFeatures: ['reports.author'],
  pageTitle: 'New Report',
  pageTitleKey: 'reports.new.pageTitle',
  navHidden: true,
  breadcrumb: [
    { label: 'Reports', labelKey: 'reports.nav.reports', href: '/backend/reports' },
    { label: 'New Report', labelKey: 'reports.new.pageTitle' },
  ],
}
