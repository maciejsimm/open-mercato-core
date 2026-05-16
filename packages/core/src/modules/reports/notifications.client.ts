'use client'

import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import { ReportExecutionReadyRenderer } from './widgets/notifications/ReportExecutionReadyRenderer'
import { ReportScheduleDeliveredRenderer } from './widgets/notifications/ReportScheduleDeliveredRenderer'
import { ReportExportReadyRenderer } from './widgets/notifications/ReportExportReadyRenderer'

export const reportsNotificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'reports.execution_ready',
    module: 'reports',
    titleKey: 'reports.notifications.execution_ready.title',
    bodyKey: 'reports.notifications.execution_ready.body',
    icon: 'file-bar-chart',
    severity: 'success',
    actions: [
      {
        id: 'view',
        labelKey: 'reports.notifications.actions.viewReport',
        variant: 'outline',
        href: '/backend/reports/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    primaryActionId: 'view',
    linkHref: '/backend/reports/{sourceEntityId}',
    Renderer: ReportExecutionReadyRenderer,
    expiresAfterHours: 168,
  },
  {
    type: 'reports.schedule_delivered',
    module: 'reports',
    titleKey: 'reports.notifications.schedule_delivered.title',
    bodyKey: 'reports.notifications.schedule_delivered.body',
    icon: 'mail',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'reports.notifications.actions.viewSchedule',
        variant: 'outline',
        href: '/backend/reports/schedules',
        icon: 'external-link',
      },
    ],
    primaryActionId: 'view',
    linkHref: '/backend/reports/schedules',
    Renderer: ReportScheduleDeliveredRenderer,
    expiresAfterHours: 168,
  },
  {
    type: 'reports.export_ready',
    module: 'reports',
    titleKey: 'reports.notifications.export_ready.title',
    bodyKey: 'reports.notifications.export_ready.body',
    icon: 'download',
    severity: 'success',
    actions: [
      {
        id: 'download',
        labelKey: 'reports.notifications.actions.downloadExport',
        variant: 'default',
        href: '{attachmentDownloadUrl}',
        icon: 'download',
      },
    ],
    primaryActionId: 'download',
    Renderer: ReportExportReadyRenderer,
    expiresAfterHours: 168,
  },
]

export default reportsNotificationTypes
