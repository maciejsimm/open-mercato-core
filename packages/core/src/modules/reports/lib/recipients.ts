import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User, UserRole } from '@open-mercato/core/modules/auth/data/entities'

export type ScheduleRecipientInput =
  | { type: 'user'; userId: string }
  | { type: 'role'; roleId: string }
  | { type: 'email'; email: string }

const MAX_RECIPIENTS = 200

function readRecipients(raw: unknown): ScheduleRecipientInput[] {
  if (!Array.isArray(raw)) return []
  const out: ScheduleRecipientInput[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (record.type === 'user' && typeof record.userId === 'string') out.push({ type: 'user', userId: record.userId })
    else if (record.type === 'role' && typeof record.roleId === 'string') out.push({ type: 'role', roleId: record.roleId })
    else if (record.type === 'email' && typeof record.email === 'string') out.push({ type: 'email', email: record.email })
  }
  return out
}

/**
 * Resolve schedule recipients to distinct email addresses within the
 * schedule's organization. `user` and `role` recipients resolve through
 * live user/role membership (deleted users and roles drop out); users whose
 * home organization is a different organization are excluded, so one
 * organization's data is never mailed to another's users. Tenant-wide
 * users (no home organization) are included. `email` recipients are
 * included only when `allowExternal` (owner holds `reports.admin`).
 */
export async function resolveRecipientEmails(
  em: EntityManager,
  raw: unknown,
  scope: { tenantId: string; organizationId: string },
  options: { allowExternal: boolean },
): Promise<{ emails: string[]; droppedExternal: number }> {
  const recipients = readRecipients(raw)
  const userIds = new Set<string>()
  const emails = new Set<string>()
  let droppedExternal = 0
  const roleIds = recipients.filter((r): r is { type: 'role'; roleId: string } => r.type === 'role').map((r) => r.roleId)
  for (const r of recipients) {
    if (r.type === 'user') userIds.add(r.userId)
    if (r.type === 'email') {
      if (options.allowExternal) emails.add(r.email.trim().toLowerCase())
      else droppedExternal += 1
    }
  }
  if (roleIds.length) {
    const memberships = await findWithDecryption(
      em,
      UserRole,
      { role: { $in: roleIds }, deletedAt: null } as Record<string, unknown>,
      { populate: ['user', 'role'] } as Record<string, unknown>,
      scope,
    )
    for (const membership of memberships) {
      const role = membership.role as { tenantId?: string; deletedAt?: Date | null } | undefined
      if (role && (role.deletedAt || (role.tenantId && role.tenantId !== scope.tenantId))) continue
      const user = membership.user as { id?: string } | string | undefined
      const id = typeof user === 'string' ? user : user?.id
      if (id) userIds.add(id)
    }
  }
  if (userIds.size) {
    const users = await findWithDecryption(
      em,
      User,
      { id: { $in: Array.from(userIds) }, tenantId: scope.tenantId, deletedAt: null } as Record<string, unknown>,
      {},
      scope,
    )
    for (const user of users) {
      const homeOrganizationId = (user as { organizationId?: string | null }).organizationId ?? null
      if (homeOrganizationId && homeOrganizationId !== scope.organizationId) continue
      const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : ''
      if (email.includes('@')) emails.add(email)
    }
  }
  return { emails: Array.from(emails).slice(0, MAX_RECIPIENTS), droppedExternal }
}
