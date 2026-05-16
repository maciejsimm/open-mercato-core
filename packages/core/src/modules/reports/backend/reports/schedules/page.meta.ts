import React from 'react'

const schedulesIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('circle', { cx: 12, cy: 12, r: 9 }),
  React.createElement('path', { d: 'M12 7v5l3 2' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['reports.schedule'],
  pageTitle: 'Schedules',
  pageTitleKey: 'reports.schedules.nav.title',
  pageGroup: 'Reports',
  pageGroupKey: 'reports.nav.group',
  pagePriority: 50,
  pageOrder: 130,
  icon: schedulesIcon,
  breadcrumb: [
    { label: 'Reports', labelKey: 'reports.nav.reports', href: '/backend/reports' },
    { label: 'Schedules', labelKey: 'reports.schedules.nav.title' },
  ],
}
