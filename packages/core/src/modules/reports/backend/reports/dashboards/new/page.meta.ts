// Truly hidden from the sidebar. The previous `hideInNav: true` was a
// typo for `navHidden`; correctly hiding it now keeps the Dashboards
// sub-nav focused on the children the user asked for (New Embed, New
// Schedule). Accessible via the Dashboards list page CTA.
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
