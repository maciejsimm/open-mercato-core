'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, ExternalLink, type LucideIcon } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import type { NotificationRendererProps } from '@open-mercato/shared/modules/notifications/types'

type SeverityKey = 'info' | 'success' | 'warning' | 'error'

const severityClasses: Record<SeverityKey, { border: string; tint: string; iconBg: string; icon: string }> = {
  info: {
    border: 'border-l-status-info-border',
    tint: 'bg-status-info-bg/50',
    iconBg: 'bg-status-info-bg',
    icon: 'text-status-info-icon',
  },
  success: {
    border: 'border-l-status-success-border',
    tint: 'bg-status-success-bg/50',
    iconBg: 'bg-status-success-bg',
    icon: 'text-status-success-icon',
  },
  warning: {
    border: 'border-l-status-warning-border',
    tint: 'bg-status-warning-bg/50',
    iconBg: 'bg-status-warning-bg',
    icon: 'text-status-warning-icon',
  },
  error: {
    border: 'border-l-status-danger-border',
    tint: 'bg-status-danger-bg/50',
    iconBg: 'bg-status-danger-bg',
    icon: 'text-status-danger-icon',
  },
}

function resolveSeverity(value: string | undefined): SeverityKey {
  if (value === 'success' || value === 'warning' || value === 'error') return value
  return 'info'
}

type Props = NotificationRendererProps & {
  icon: LucideIcon
  primaryActionLabel: string
  /** Optional secondary block rendered above the actions row. */
  secondaryBlock?: React.ReactNode
}

export function ReportNotificationCard({
  notification,
  onAction,
  onDismiss,
  actions = [],
  icon: Icon,
  primaryActionLabel,
  secondaryBlock,
}: Props) {
  const t = useT()
  const router = useRouter()
  const [executing, setExecuting] = React.useState(false)
  const isUnread = notification.status === 'unread'
  const severity = severityClasses[resolveSeverity(notification.severity)]

  const primaryAction =
    actions.find((action) => action.id === 'download') ??
    actions.find((action) => action.id === 'view') ??
    actions[0] ??
    null

  const triggerPrimary = async () => {
    if (!primaryAction) {
      if (notification.linkHref) router.push(notification.linkHref)
      return
    }
    setExecuting(true)
    try {
      await onAction(primaryAction.id)
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div
      className={cn(
        'group relative cursor-pointer border-l-4 px-4 py-3 transition-colors hover:bg-muted/50',
        severity.border,
        isUnread && severity.tint,
      )}
      onClick={triggerPrimary}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          triggerPrimary()
        }
      }}
      role="button"
      tabIndex={0}
    >
      {isUnread && (
        <div className="absolute left-1.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-primary" aria-hidden />
      )}

      <div className="flex gap-3">
        <div className="mt-0.5 flex-shrink-0">
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', severity.iconBg)}>
            <Icon className={cn('h-5 w-5', severity.icon)} aria-hidden />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className={cn('text-sm font-medium text-foreground', isUnread && 'font-semibold')}>
              {notification.title}
            </h4>
            <span className="flex flex-shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" aria-hidden />
              {formatRelativeTime(notification.createdAt, { translate: t }) ?? ''}
            </span>
          </div>

          {notification.body && (
            <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>
          )}

          {secondaryBlock && <div className="mt-2 text-xs text-muted-foreground">{secondaryBlock}</div>}

          <div className="mt-3 flex gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={(event) => {
                event.stopPropagation()
                triggerPrimary()
              }}
              disabled={executing || (!primaryAction && !notification.linkHref)}
              className="gap-1"
            >
              <ExternalLink className="h-3 w-3" aria-hidden />
              {primaryActionLabel}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(event) => {
                event.stopPropagation()
                onDismiss()
              }}
            >
              {t('notifications.actions.dismiss', 'Dismiss')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ReportNotificationCard
