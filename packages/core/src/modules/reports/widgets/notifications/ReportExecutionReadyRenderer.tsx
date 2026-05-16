'use client'

import * as React from 'react'
import { FileBarChart } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { NotificationRendererProps } from '@open-mercato/shared/modules/notifications/types'
import { ReportNotificationCard } from './ReportNotificationCard'

export function ReportExecutionReadyRenderer(props: NotificationRendererProps) {
  const t = useT()
  const rowCount = props.notification.bodyVariables?.rowCount
  const datasetLabel = props.notification.bodyVariables?.datasetLabel

  const secondary = rowCount || datasetLabel
    ? (
        <span className="flex flex-wrap items-center gap-3 font-mono">
          {datasetLabel && <span>{datasetLabel}</span>}
          {rowCount && (
            <span>
              {t('reports.notifications.renderer.rowCount', '{count} rows').replace('{count}', String(rowCount))}
            </span>
          )}
        </span>
      )
    : undefined

  return (
    <ReportNotificationCard
      {...props}
      icon={FileBarChart}
      primaryActionLabel={t('reports.notifications.actions.viewReport', 'View report')}
      secondaryBlock={secondary}
    />
  )
}

export default ReportExecutionReadyRenderer
