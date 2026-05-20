import React from 'react'

const embedsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
  React.createElement('path', { d: 'M8 8h8' }),
  React.createElement('path', { d: 'M8 12h5' }),
  React.createElement('path', { d: 'M8 16h8' }),
)

// Hidden from the sidebar — accessed via the "New Embed" child of
// Dashboards or via deep link. Embeds list management lives on the
// per-record detail UI rather than as a global sidebar entry.
export const metadata = {
  requireAuth: true,
  requireFeatures: ['reports.embed.manage'],
  pageTitle: 'Embeds',
  pageTitleKey: 'reports.embeds.nav.title',
  navHidden: true,
  pagePriority: 50,
  pageOrder: 120,
  icon: embedsIcon,
  breadcrumb: [
    { label: 'Reports', labelKey: 'reports.nav.reports', href: '/backend/reports' },
    { label: 'Embeds', labelKey: 'reports.embeds.nav.title' },
  ],
}
