import React from 'react'

const reportsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M3 3v18h18' }),
  React.createElement('rect', { x: 7, y: 10, width: 3, height: 8 }),
  React.createElement('rect', { x: 12, y: 6, width: 3, height: 12 }),
  React.createElement('rect', { x: 17, y: 13, width: 3, height: 5 })
)

// Top-level entry — no `pageGroup` so the link stays visible in the
// sidebar even when the secondary "Reports" admin group (Schedules,
// Embeds) is collapsed by the user.
export const metadata = {
  requireAuth: true,
  requireFeatures: ['reports.view'],
  pageTitle: 'Reports',
  pageTitleKey: 'reports.nav.reports',
  pagePriority: 50,
  pageOrder: 100,
  icon: reportsIcon,
  breadcrumb: [{ label: 'Reports', labelKey: 'reports.nav.reports' }],
}
