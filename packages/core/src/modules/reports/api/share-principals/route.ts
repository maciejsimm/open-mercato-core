import { NextResponse } from 'next/server'
import { z } from 'zod'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Role, User } from '@open-mercato/core/modules/auth/data/entities'
import { resolveReportsRequestAccess } from '../../lib/access'
import { reportsTag, reportsErrorSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['reports.share'] },
}

const MAX_PRINCIPALS = 500

const principalsResponseSchema = z.object({
  users: z.array(z.object({ id: z.string().uuid(), label: z.string(), email: z.string().nullable() })),
  roles: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
})

/**
 * Users and roles a report folder can be shared with: people of the caller's
 * tenant whose home organization is the active organization (or tenant-wide
 * users), and the tenant's roles. Gated by `reports.share` so sharing does
 * not require the auth administration features.
 */
export async function GET(req: Request) {
  const resolved = await resolveReportsRequestAccess(req)
  if (!resolved.ok) return resolved.response
  const { access, em } = resolved
  const scope = { tenantId: access.tenantId, organizationId: access.organizationId }

  const users = await findWithDecryption(
    em,
    User,
    { tenantId: access.tenantId, deletedAt: null } as Record<string, unknown>,
    { limit: MAX_PRINCIPALS, orderBy: { createdAt: 'ASC' } } as Record<string, unknown>,
    scope,
  )
  const roles = await findWithDecryption(
    em,
    Role,
    { tenantId: access.tenantId, deletedAt: null } as Record<string, unknown>,
    { limit: MAX_PRINCIPALS, orderBy: { name: 'ASC' } } as Record<string, unknown>,
    scope,
  )

  return NextResponse.json({
    users: users
      .filter((user) => {
        const kind = (user as { kind?: string }).kind
        if (kind && kind !== 'human') return false
        return !user.organizationId || user.organizationId === access.organizationId
      })
      .map((user) => {
        const email = typeof user.email === 'string' ? user.email : null
        const name = typeof user.name === 'string' && user.name.trim() ? user.name.trim() : null
        return { id: user.id, label: name ?? email ?? user.id, email }
      })
      .sort((a, b) => a.label.localeCompare(b.label)),
    roles: roles.map((role) => ({ id: role.id, name: role.name })),
  })
}

export const openApi = {
  tag: reportsTag,
  summary: 'Principals a report folder can be shared with',
  methods: {
    GET: {
      summary: 'List users and roles for folder sharing',
      tags: [reportsTag],
      responses: [{ status: 200, description: 'Users and roles of the tenant', schema: principalsResponseSchema }],
      errors: [{ status: 401, description: 'Auth required', schema: reportsErrorSchema }],
    },
  },
}
