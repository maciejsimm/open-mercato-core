// Surfaced under "Dashboards" in the sidebar via explicit `pageParent`,
// rather than under "Embeds" via URL-prefix nesting. The previous
// `hideInNav: true` was a typo (correct field is `navHidden`) and didn't
// actually hide the entry — we now expose it intentionally as a child
// of Dashboards.
export const metadata = {
  requireAuth: true,
  requireFeatures: ['reports.embed.manage'],
  pageTitle: 'New Embed',
  pageTitleKey: 'reports.embeds.new.pageTitle',
  pageParent: '/backend/reports/dashboards',
  pageOrder: 20,
  breadcrumb: [
    { label: 'Reports', labelKey: 'reports.nav.reports', href: '/backend/reports' },
    { label: 'Embeds', labelKey: 'reports.embeds.nav.title', href: '/backend/reports/embeds' },
    { label: 'New Embed', labelKey: 'reports.embeds.new.pageTitle' },
  ],
}
