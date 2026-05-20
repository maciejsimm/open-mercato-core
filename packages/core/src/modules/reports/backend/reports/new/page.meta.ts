// Shown as a sub-item of "Reports" (URL-prefix nesting). The previous
// `hideInNav: true` flag was a typo for `navHidden: true` and was
// silently ignored, which is why the page already appears in the
// sidebar — we keep it visible intentionally now and tighten the title.
export const metadata = {
  requireAuth: true,
  requireFeatures: ['reports.author'],
  pageTitle: 'New Report',
  pageTitleKey: 'reports.new.pageTitle',
  pageOrder: 10,
  breadcrumb: [
    { label: 'Reports', labelKey: 'reports.nav.reports', href: '/backend/reports' },
    { label: 'New Report', labelKey: 'reports.new.pageTitle' },
  ],
}
