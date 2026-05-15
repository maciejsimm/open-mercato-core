import { z } from 'zod'

const uuid = () => z.string().uuid()

const positionSchema = z.number().int().min(0).max(1_000_000)
const nameSchema = z.string().trim().min(1).max(200)
const descriptionSchema = z.string().trim().max(4_000)
const datasetIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, {
    message: 'datasetId must match <module>.<entity>',
  })

// ---------- Folders ----------

export const folderKindSchema = z.enum(['private', 'public'])

export const folderCreateSchema = z.object({
  parentFolderId: uuid().nullable().optional(),
  kind: folderKindSchema,
  name: nameSchema,
  position: positionSchema.optional(),
})
export type FolderCreateInput = z.infer<typeof folderCreateSchema>

export const folderUpdateSchema = z.object({
  id: uuid(),
  parentFolderId: uuid().nullable().optional(),
  name: nameSchema.optional(),
  position: positionSchema.optional(),
})
export type FolderUpdateInput = z.infer<typeof folderUpdateSchema>

export const folderDeleteSchema = z.object({
  id: uuid(),
  withSchedules: z.boolean().optional(),
})
export type FolderDeleteInput = z.infer<typeof folderDeleteSchema>

// ---------- Folder shares ----------

export const folderShareCreateSchema = z.object({
  folderId: uuid(),
  principalType: z.enum(['user', 'role']),
  principalId: uuid(),
  permission: z.enum(['view', 'edit']),
})
export type FolderShareCreateInput = z.infer<typeof folderShareCreateSchema>

export const folderShareDeleteSchema = z.object({
  id: uuid(),
})
export type FolderShareDeleteInput = z.infer<typeof folderShareDeleteSchema>

// ---------- Report definition shape ----------

const filterOpSchema = z.enum([
  'eq',
  'ne',
  'in',
  'nin',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'starts_with',
  'ends_with',
  'is_null',
  'is_not_null',
  'between',
])

const sortSchema = z.object({
  field: z.string().min(1),
  dir: z.enum(['asc', 'desc']),
})

const dateRangeTokenSchema = z.enum([
  'today',
  'yesterday',
  'last_24h',
  'last_7_days',
  'last_30_days',
  'mtd',
  'last_month',
  'qtd',
  'last_quarter',
  'ytd',
  'last_year',
  'custom',
])

const literalFilterSchema = z.object({
  kind: z.literal('literal'),
  field: z.string().min(1),
  op: filterOpSchema,
  value: z.unknown().optional(),
})

const parameterFilterSchema = z.object({
  kind: z.literal('parameter'),
  field: z.string().min(1),
  op: filterOpSchema,
  parameter: z.string().min(1),
})

const dateRangeFilterSchema = z.object({
  kind: z.literal('date_range'),
  field: z.string().min(1),
  token: dateRangeTokenSchema,
  from: z.string().optional(),
  to: z.string().optional(),
})

type FilterShape =
  | { kind: 'literal'; field: string; op: z.infer<typeof filterOpSchema>; value?: unknown }
  | { kind: 'parameter'; field: string; op: z.infer<typeof filterOpSchema>; parameter: string }
  | { kind: 'date_range'; field: string; token: z.infer<typeof dateRangeTokenSchema>; from?: string; to?: string }
  | { kind: 'group'; op: 'and' | 'or'; children: FilterShape[] }

const filterSchema: z.ZodType<FilterShape> = z.lazy(() =>
  z.union([
    literalFilterSchema,
    parameterFilterSchema,
    dateRangeFilterSchema,
    z.object({
      kind: z.literal('group'),
      op: z.enum(['and', 'or']),
      children: z.array(filterSchema).min(1),
    }),
  ]),
)

const flatListDefinitionSchema = z.object({
  type: z.literal('flat_list'),
  fields: z.array(z.string().min(1)).min(1).max(100),
  filters: z.array(filterSchema).default([]),
  sort: z.array(sortSchema).default([]),
  limit: z.number().int().min(1).max(100_000).optional(),
})

const measureExprSchema = z.object({
  field: z.string().min(1),
  aggregation: z.enum(['count', 'count_distinct', 'sum', 'avg', 'min', 'max']),
  alias: z.string().trim().min(1).max(100).optional(),
})

// Discriminator-ready but Phase 1 only ships the flat_list arm. The remaining
// arms (grouped, pivot, chart, summary) will be added in Phase 3 alongside
// the in-memory aggregator. They are declared here as `unknown` placeholders
// so any save attempt fails closed.
const groupedDefinitionPlaceholder = z.object({
  type: z.literal('grouped'),
}).passthrough()
const pivotDefinitionPlaceholder = z.object({
  type: z.literal('pivot'),
}).passthrough()
const chartDefinitionPlaceholder = z.object({
  type: z.literal('chart'),
}).passthrough()
const summaryDefinitionPlaceholder = z.object({
  type: z.literal('summary'),
}).passthrough()

export const reportDefinitionSchema = z.discriminatedUnion('type', [
  flatListDefinitionSchema,
  groupedDefinitionPlaceholder,
  pivotDefinitionPlaceholder,
  chartDefinitionPlaceholder,
  summaryDefinitionPlaceholder,
])
export type ReportDefinitionInput = z.infer<typeof reportDefinitionSchema>

const parameterDefSchema = z.object({
  key: z.string().min(1).max(80).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  labelKey: z.string().min(1).max(200).optional(),
  kind: z.enum(['string', 'number', 'boolean', 'date', 'date_range', 'fk', 'enum']),
  defaultValue: z.unknown().optional(),
  required: z.boolean().optional(),
  relatedDatasetId: z.string().optional(),
  options: z.array(z.union([z.string(), z.number(), z.object({ value: z.union([z.string(), z.number()]), labelKey: z.string().optional() })])).optional(),
})

// ---------- Reports ----------

export const reportCreateSchema = z.object({
  folderId: uuid(),
  name: nameSchema,
  description: descriptionSchema.optional().nullable(),
  type: z.enum(['flat_list', 'grouped', 'pivot', 'chart', 'summary']),
  datasetId: datasetIdSchema,
  definition: reportDefinitionSchema,
  parameters: z.array(parameterDefSchema).optional(),
})
export type ReportCreateInput = z.infer<typeof reportCreateSchema>

export const reportUpdateSchema = z.object({
  id: uuid(),
  folderId: uuid().optional(),
  name: nameSchema.optional(),
  description: descriptionSchema.optional().nullable(),
  definition: reportDefinitionSchema.optional(),
  parameters: z.array(parameterDefSchema).optional(),
  version: z.number().int().min(1).optional(),
})
export type ReportUpdateInput = z.infer<typeof reportUpdateSchema>

export const reportDeleteSchema = z.object({
  id: uuid(),
})
export type ReportDeleteInput = z.infer<typeof reportDeleteSchema>

export const reportMoveSchema = z.object({
  id: uuid(),
  folderId: uuid(),
})
export type ReportMoveInput = z.infer<typeof reportMoveSchema>

// ---------- Run ----------

export const reportRunSchema = z.object({
  params: z.record(z.string(), z.unknown()).optional(),
  mode: z.enum(['sync', 'async']).optional(),
})
export type ReportRunInput = z.infer<typeof reportRunSchema>
