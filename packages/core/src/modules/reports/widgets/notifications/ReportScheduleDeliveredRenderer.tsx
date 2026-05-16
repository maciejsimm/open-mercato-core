'use client'

import * as React from 'react'
import { Mail } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { NotificationRendererProps } from '@open-mercato/shared/modules/notifications/types'
import { ReportNotificationCard } from './ReportNotificationCard'

export function ReportScheduleDeliveredRenderer(props: NotificationRendererProps) {
  const t = useT()
  const recipientCount = props.notification.bodyVariables?.recipientCount
  const formats = props.notification.bodyVariables?.formats

  const secondary = (
    <span className="flex flex-wrap items-center gap-3">
      {recipientCount && (
        <span>{t('reports.notifications.renderer.recipientCount', '{count} recipients').replace('{count}', String(recipientCount))}</span>
      )}
      {formats && <span className="font-mono uppercase">{formats}</span>}
    </span>
  )

  return (
    <ReportNotificationCard
      {...props}
      icon={Mail}
      primaryActionLabel={t('reports.notifications.actions.viewSchedule', 'View schedule')}
      secondaryBlock={recipientCount || formats ? secondary : undefined}
    />
  )
}

export default ReportScheduleDeliveredRenderer
