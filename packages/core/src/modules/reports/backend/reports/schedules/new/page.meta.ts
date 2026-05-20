// Surfaced under "Dashboards" in the sidebar via explicit `pageParent`,
// rather than under "Schedules" via URL-prefix nesting. The previous
// `hideInNav: true` was a typo (correct field is `navHidden`) and didn't
// actually hide the entry — we now expose it intentionally as a child
// of Dashboards.
export const metadata = {
  requireAuth: true,
  requireFeatures: ['reports.schedule'],
  pageTitle: 'New Schedule',
  pageTitleKey: 'reports.schedules.new.pageTitle',
  pageParent: '/backend/reports/dashboards',
  pageOrder: 30,
  breadcrumb: [
    { label: 'Reports', labelKey: 'reports.nav.reports', href: '/backend/reports' },
    { label: 'Schedules', labelKey: 'reports.schedules.nav.title', href: '/backend/reports/schedules' },
    { label: 'New Schedule', labelKey: 'reports.schedules.new.pageTitle' },
  ],
}
