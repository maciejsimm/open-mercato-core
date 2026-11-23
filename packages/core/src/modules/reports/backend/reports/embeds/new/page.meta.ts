// Hidden from the sidebar; reached from the Embeds list "New embed" action.
export const metadata = {
  requireAuth: true,
  requireFeatures: ['reports.embed.manage'],
  pageTitle: 'New Embed',
  pageTitleKey: 'reports.embeds.new.pageTitle',
  navHidden: true,
  breadcrumb: [
    { label: 'Reports', labelKey: 'reports.nav.reports', href: '/backend/reports' },
    { label: 'Embeds', labelKey: 'reports.embeds.nav.title', href: '/backend/reports/embeds' },
    { label: 'New Embed', labelKey: 'reports.embeds.new.pageTitle' },
  ],
}
