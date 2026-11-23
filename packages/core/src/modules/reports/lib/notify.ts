import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'

const logger = createLogger('reports').child({ component: 'notify' })

type Resolver = { resolve: <T = unknown>(name: string) => T }

export type ReportsNotificationInput = {
  recipientUserId: string
  bodyVariables?: Record<string, string>
  sourceEntityType: string
  sourceEntityId: string
  linkHref?: string
  groupKey?: string
}

/**
 * Emit an in-app notification of one of this module's declared types.
 * Never throws: a notification failure must not fail the run that caused it.
 */
export async function notifyReportsUser(
  container: Resolver,
  type: string,
  input: ReportsNotificationInput,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  const typeDef = notificationTypes.find((entry) => entry.type === type)
  if (!typeDef) return
  try {
    const service = resolveNotificationService(container)
    await service.create(
      buildNotificationFromType(typeDef, {
        recipientUserId: input.recipientUserId,
        bodyVariables: input.bodyVariables,
        titleVariables: input.bodyVariables,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
        linkHref: input.linkHref,
        groupKey: input.groupKey,
      }),
      scope,
    )
  } catch (err) {
    logger.warn('Failed to emit reports notification', { type, err })
  }
}

export function executionDownloadHref(executionId: string, format = 'csv'): string {
  return `/api/reports/executions/${encodeURIComponent(executionId)}/download?format=${encodeURIComponent(format)}`
}
