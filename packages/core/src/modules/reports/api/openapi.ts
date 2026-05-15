import { z } from 'zod'
import type { OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'

export const reportsTag = { name: 'Reports', description: 'Reports & analytics module' }

export const reportsErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) })
export const reportsOkSchema = z.object({ ok: z.literal(true) })

export const reportsListAuthErrors: OpenApiMethodDoc['errors'] = [
  { status: 401, description: 'Authentication required', schema: reportsErrorSchema },
  { status: 403, description: 'Missing reports feature', schema: reportsErrorSchema },
]
