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

export const measureExprSchema = z.object({
  field: z.string().min(1),
  aggregation: z.enum(['count', 'count_distinct', 'sum', 'avg', 'min', 'max']),
  alias: z.string().trim().min(1).max(100).optional(),
})
export type MeasureExprInput = z.infer<typeof measureExprSchema>

export const chartTypeSchema = z.enum([
  'bar',
  'line',
  'pie',
  'donut',
  'area',
  'scatter',
  'combo',
])
export type ChartTypeInput = z.infer<typeof chartTypeSchema>

export const chartSpecSchema = z
  .object({
    type: chartTypeSchema,
    xField: z.string().min(1),
    yFields: z.array(z.string().min(1)).min(1).max(20),
    stacked: z.boolean().optional(),
    showLegend: z.boolean().optional(),
    xAxisLabel: z.string().trim().max(120).optional(),
    yAxisLabel: z.string().trim().max(120).optional(),
    palette: z.array(z.string().regex(/^[a-zA-Z0-9_-]+$/)).max(20).optional(),
  })
  .superRefine((spec, ctx) => {
    if ((spec.type === 'pie' || spec.type === 'donut') && spec.yFields.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['yFields'],
        message: `${spec.type} charts require exactly one yField`,
      })
    }
    if (spec.type === 'scatter' && spec.yFields.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['yFields'],
        message: 'scatter charts require exactly one yField',
      })
    }
  })
export type ChartSpecInput = z.infer<typeof chartSpecSchema>

const fieldsListSchema = z.array(z.string().min(1)).min(1).max(100)
const groupByListSchema = z.array(z.string().min(1)).min(1).max(10)
const measuresListSchema = z.array(measureExprSchema).min(1).max(20)

const groupedDefinitionSchema = z
  .object({
    type: z.literal('grouped'),
    fields: fieldsListSchema,
    groupBy: groupByListSchema,
    measures: measuresListSchema,
    filters: z.array(filterSchema).default([]),
    sort: z.array(sortSchema).default([]),
    limit: z.number().int().min(1).max(100_000).optional(),
  })
  .superRefine((def, ctx) => {
    const aliases = new Set<string>()
    def.measures.forEach((m, idx) => {
      if (!m.alias) return
      if (aliases.has(m.alias)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['measures', idx, 'alias'],
          message: `Duplicate measure alias '${m.alias}'`,
        })
      }
      aliases.add(m.alias)
    })
  })

const pivotDefinitionSchema = z
  .object({
    type: z.literal('pivot'),
    rows: z.array(z.string().min(1)).min(1).max(10),
    cols: z.array(z.string().min(1)).min(1).max(10),
    value: measureExprSchema,
    filters: z.array(filterSchema).default([]),
  })
  .superRefine((def, ctx) => {
    const rows = new Set(def.rows)
    for (const col of def.cols) {
      if (rows.has(col)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cols'],
          message: `Field '${col}' cannot appear in both rows and cols`,
        })
      }
    }
  })

const chartDefinitionSchema = z
  .object({
    type: z.literal('chart'),
    chart: chartSpecSchema,
    filters: z.array(filterSchema).default([]),
    groupBy: z.array(z.string().min(1)).max(10).optional(),
    measures: z.array(measureExprSchema).max(20).optional(),
    limit: z.number().int().min(1).max(100_000).optional(),
  })
  .superRefine((def, ctx) => {
    const xField = def.chart.xField
    const yFields = def.chart.yFields
    if (def.groupBy && def.groupBy.length > 0 && !def.groupBy.includes(xField)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['chart', 'xField'],
        message: `chart.xField '${xField}' must be one of the groupBy keys when groupBy is set`,
      })
    }
    if (def.measures && def.measures.length > 0) {
      const aliases = new Set(def.measures.map((m) => m.alias ?? `${m.aggregation}_${m.field}`))
      for (const y of yFields) {
        if (!aliases.has(y)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['chart', 'yFields'],
            message: `chart.yFields contains '${y}' which is not produced by any declared measure alias`,
          })
        }
      }
    }
  })

const summaryDefinitionSchema = z.object({
  type: z.literal('summary'),
  measures: measuresListSchema,
  filters: z.array(filterSchema).default([]),
})

export const reportDefinitionSchema = z.discriminatedUnion('type', [
  flatListDefinitionSchema,
  groupedDefinitionSchema,
  pivotDefinitionSchema,
  chartDefinitionSchema,
  summaryDefinitionSchema,
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

// ---------- Dashboards ----------

const tileModeSchema = z.enum(['inline', 'summary', 'chart-only'])

const parameterBindingSchema = z.union([
  z.object({ source: z.literal('literal'), value: z.unknown() }),
  z.object({ source: z.literal('parameter'), parameter: z.string().min(1) }),
  z.object({ source: z.literal('record-field'), recordField: z.string().min(1) }),
])

const dashboardTileSchema = z.object({
  id: z.string().min(1).max(80),
  reportId: uuid(),
  x: z.number().int().min(0).max(1000),
  y: z.number().int().min(0).max(10_000),
  w: z.number().int().min(1).max(48),
  h: z.number().int().min(1).max(96),
  mode: tileModeSchema.default('inline'),
  title: z.string().trim().max(200).optional(),
  paramBindings: z.record(z.string(), parameterBindingSchema).optional(),
})
export type DashboardTileInput = z.infer<typeof dashboardTileSchema>

const dashboardGridSchema = z.object({
  cols: z.number().int().min(1).max(48).default(12),
  rowHeight: z.number().int().min(20).max(400).default(80),
  gap: z.number().int().min(0).max(64).default(8),
})

export const dashboardLayoutSchema = z.object({
  grid: dashboardGridSchema.default({ cols: 12, rowHeight: 80, gap: 8 }),
  tiles: z.array(dashboardTileSchema).max(60),
})
  .superRefine((layout, ctx) => {
    const ids = new Set<string>()
    layout.tiles.forEach((tile, idx) => {
      if (ids.has(tile.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tiles', idx, 'id'],
          message: `Duplicate tile id '${tile.id}'`,
        })
      }
      ids.add(tile.id)
    })
  })
export type DashboardLayoutInput = z.infer<typeof dashboardLayoutSchema>

export const dashboardCreateSchema = z.object({
  folderId: uuid(),
  name: nameSchema,
  description: descriptionSchema.optional().nullable(),
  layout: dashboardLayoutSchema,
  parameters: z.array(parameterDefSchema).optional(),
})
export type DashboardCreateInput = z.infer<typeof dashboardCreateSchema>

export const dashboardUpdateSchema = z.object({
  id: uuid(),
  folderId: uuid().optional(),
  name: nameSchema.optional(),
  description: descriptionSchema.optional().nullable(),
  layout: dashboardLayoutSchema.optional(),
  parameters: z.array(parameterDefSchema).optional(),
  version: z.number().int().min(1).optional(),
})
export type DashboardUpdateInput = z.infer<typeof dashboardUpdateSchema>

export const dashboardDeleteSchema = z.object({
  id: uuid(),
})
export type DashboardDeleteInput = z.infer<typeof dashboardDeleteSchema>

export const dashboardMoveSchema = z.object({
  id: uuid(),
  folderId: uuid(),
})
export type DashboardMoveInput = z.infer<typeof dashboardMoveSchema>

export const dashboardRunSchema = z.object({
  params: z.record(z.string(), z.unknown()).optional(),
})
export type DashboardRunInput = z.infer<typeof dashboardRunSchema>
