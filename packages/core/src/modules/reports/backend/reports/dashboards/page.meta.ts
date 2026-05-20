import React from 'react'

const dashboardsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: 3, y: 3, width: 7, height: 9, rx: 1 }),
  React.createElement('rect', { x: 14, y: 3, width: 7, height: 5, rx: 1 }),
  React.createElement('rect', { x: 14, y: 12, width: 7, height: 9, rx: 1 }),
  React.createElement('rect', { x: 3, y: 16, width: 7, height: 5, rx: 1 }),
)

// Top-level entry — same rationale as the Reports list page: this should
// stay visible in the sidebar regardless of group-collapse state.
export const metadata = {
  requireAuth: true,
  requireFeatures: ['reports.view'],
  pageTitle: 'Dashboards',
  pageTitleKey: 'reports.dashboards.nav.title',
  pagePriority: 50,
  pageOrder: 110,
  icon: dashboardsIcon,
  breadcrumb: [
    { label: 'Reports', labelKey: 'reports.nav.reports', href: '/backend/reports' },
    { label: 'Dashboards', labelKey: 'reports.dashboards.nav.title' },
  ],
}
