// Hidden from the sidebar; reached from the Schedules list "New schedule" action.
export const metadata = {
  requireAuth: true,
  requireFeatures: ['reports.schedule'],
  pageTitle: 'New Schedule',
  pageTitleKey: 'reports.schedules.new.pageTitle',
  navHidden: true,
  breadcrumb: [
    { label: 'Reports', labelKey: 'reports.nav.reports', href: '/backend/reports' },
    { label: 'Schedules', labelKey: 'reports.schedules.nav.title', href: '/backend/reports/schedules' },
    { label: 'New Schedule', labelKey: 'reports.schedules.new.pageTitle' },
  ],
}
