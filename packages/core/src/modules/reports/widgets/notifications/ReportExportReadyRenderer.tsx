'use client'

import * as React from 'react'
import { Download } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { NotificationRendererProps } from '@open-mercato/shared/modules/notifications/types'
import { ReportNotificationCard } from './ReportNotificationCard'

export function ReportExportReadyRenderer(props: NotificationRendererProps) {
  const t = useT()
  const format = props.notification.bodyVariables?.format
  const sizeLabel = props.notification.bodyVariables?.sizeLabel

  const secondary = format || sizeLabel
    ? (
        <span className="flex flex-wrap items-center gap-3 font-mono">
          {format && <span className="uppercase">{format}</span>}
          {sizeLabel && <span>{sizeLabel}</span>}
        </span>
      )
    : undefined

  return (
    <ReportNotificationCard
      {...props}
      icon={Download}
      primaryActionLabel={t('reports.notifications.actions.downloadExport', 'Download export')}
      secondaryBlock={secondary}
    />
  )
}

export default ReportExportReadyRenderer
