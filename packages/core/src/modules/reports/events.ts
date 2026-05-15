import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  // Reports
  { id: 'reports.report.created', label: 'Report Created', entity: 'report', category: 'crud' },
  { id: 'reports.report.updated', label: 'Report Updated', entity: 'report', category: 'crud' },
  { id: 'reports.report.deleted', label: 'Report Deleted', entity: 'report', category: 'crud' },
  { id: 'reports.report.executed', label: 'Report Executed', entity: 'report', category: 'lifecycle', clientBroadcast: true },

  // Dashboards
  { id: 'reports.dashboard.created', label: 'Dashboard Created', entity: 'dashboard', category: 'crud' },
  { id: 'reports.dashboard.updated', label: 'Dashboard Updated', entity: 'dashboard', category: 'crud' },
  { id: 'reports.dashboard.deleted', label: 'Dashboard Deleted', entity: 'dashboard', category: 'crud' },

  // Folders
  { id: 'reports.folder.created', label: 'Folder Created', entity: 'folder', category: 'crud' },
  { id: 'reports.folder.updated', label: 'Folder Updated', entity: 'folder', category: 'crud' },
  { id: 'reports.folder.deleted', label: 'Folder Deleted', entity: 'folder', category: 'crud' },
  { id: 'reports.folder.shared', label: 'Folder Shared', entity: 'folder', category: 'lifecycle' },

  // Schedules
  { id: 'reports.schedule.created', label: 'Schedule Created', entity: 'schedule', category: 'crud' },
  { id: 'reports.schedule.updated', label: 'Schedule Updated', entity: 'schedule', category: 'crud' },
  { id: 'reports.schedule.deleted', label: 'Schedule Deleted', entity: 'schedule', category: 'crud' },
  { id: 'reports.schedule.delivered', label: 'Schedule Delivered', entity: 'schedule', category: 'lifecycle' },

  // Embeds
  { id: 'reports.embed.created', label: 'Embed Created', entity: 'embed', category: 'crud' },
  { id: 'reports.embed.updated', label: 'Embed Updated', entity: 'embed', category: 'crud' },
  { id: 'reports.embed.deleted', label: 'Embed Deleted', entity: 'embed', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'reports',
  events,
})

export const emitReportsEvent = eventsConfig.emit
export type ReportsEventId = (typeof events)[number]['id']

export default eventsConfig
