import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import {
  organizationScopeRequiredResponse,
  resolveActiveOrganizationId,
} from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { UserRole } from '@open-mercato/core/modules/auth/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { FolderAclContext, ReportFolderShareRecord } from './folder-acl'

type Resolver = { resolve: <T = unknown>(name: string) => T }

/** Server-resolved identity of the principal a report read or write runs as. */
export type ReportsAccess = {
  userId: string
  tenantId: string
  organizationId: string
  /** Live ACL grants (`*` for super-admins) — never JWT claims. */
  userFeatures: ReadonlySet<string>
  /** Role UUIDs the user holds in this tenant — matched against role shares. */
  roleIds: ReadonlySet<string>
}

/** Load the live feature set of a user in the given scope. */
export async function loadUserFeatures(
  rbac: Pick<RbacService, 'loadAcl'>,
  userId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<Set<string>> {
  const acl = await rbac.loadAcl(userId, { tenantId: scope.tenantId, organizationId: scope.organizationId })
  return new Set<string>(acl.isSuperAdmin ? ['*'] : acl.features)
}

/**
 * Role UUIDs the user holds within the tenant. Folder shares store role
 * **ids**; the JWT `roles` claim carries role **names**, so it must never be
 * used to match role shares.
 */
export async function resolveUserRoleIds(
  em: EntityManager,
  userId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<Set<string>> {
  const userRoles = await findWithDecryption(
    em,
    UserRole,
    { user: userId, deletedAt: null } as Record<string, unknown>,
    { populate: ['role'] } as Record<string, unknown>,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  const ids = new Set<string>()
  for (const userRole of userRoles) {
    const role = userRole.role as { id?: string; tenantId?: string; deletedAt?: Date | null } | string | undefined
    if (!role) continue
    if (typeof role === 'string') {
      ids.add(role)
      continue
    }
    if (role.deletedAt) continue
    if (role.tenantId && role.tenantId !== scope.tenantId) continue
    if (role.id) ids.add(role.id)
  }
  return ids
}

/** Resolve the full access context for a user id (used by workers and commands). */
export async function resolveAccessForUser(
  container: Resolver,
  em: EntityManager,
  userId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<ReportsAccess> {
  const rbac = container.resolve<RbacService>('rbacService')
  const [userFeatures, roleIds] = await Promise.all([
    loadUserFeatures(rbac, userId, scope),
    resolveUserRoleIds(em, userId, scope),
  ])
  return { userId, tenantId: scope.tenantId, organizationId: scope.organizationId, userFeatures, roleIds }
}

export type ReportsRequestAccess =
  | {
      ok: true
      auth: NonNullable<AuthContext>
      access: ReportsAccess
      container: Awaited<ReturnType<typeof createRequestContainer>>
      em: EntityManager
    }
  | { ok: false; response: Response }

/**
 * Authenticate a reports API request and resolve its scope. Fails closed:
 * no tenant → 401, no resolvable organization → 400
 * (`organization_scope_required`) instead of widening reads to the tenant.
 */
export async function resolveReportsRequestAccess(req: Request): Promise<ReportsRequestAccess> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) {
    return {
      ok: false,
      response: Response.json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, { status: 401 }),
    }
  }
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return { ok: false, response: organizationScopeRequiredResponse() }
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const access = await resolveAccessForUser(container, em, auth.sub, { tenantId: auth.tenantId, organizationId })
  return { ok: true, auth, access, container, em }
}

/** Build the folder ACL context for the given shares. */
export function buildFolderAclContext(
  access: Pick<ReportsAccess, 'userId' | 'roleIds' | 'userFeatures'>,
  shares: ReadonlyArray<ReportFolderShareRecord>,
): FolderAclContext {
  return { userId: access.userId, roleIds: access.roleIds, userFeatures: access.userFeatures, shares }
}
