import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { ParameterDef, ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { Report, ReportFolder } from './data/entities'
import { listVisibleDatasets, loadDataset } from './lib/datasets-registry'
import { executeReport } from './lib/execute'

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const eqIdx = token.indexOf('=')
    if (eqIdx > 0) {
      flags[token.slice(2, eqIdx)] = token.slice(eqIdx + 1)
      continue
    }
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next
      i += 1
    } else {
      flags[key] = true
    }
  }
  return { positional, flags }
}

async function ensurePublicRoot(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
): Promise<'created' | 'exists'> {
  const existing = await em.findOne(ReportFolder, {
    tenantId,
    organizationId,
    parentFolderId: null,
    kind: 'public',
    deletedAt: null,
  } as Record<string, unknown>)
  if (existing) return 'exists'
  const folder = em.create(ReportFolder, {
    organizationId,
    tenantId,
    parentFolderId: null,
    ownerUserId: null,
    kind: 'public',
    name: 'Public',
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  em.persist(folder)
  await em.flush()
  return 'created'
}

const rebuildFoldersCommand: ModuleCli = {
  command: 'rebuild-folders',
  async run(argv) {
    const { flags } = parseArgs(argv)
    const targetTenant = typeof flags.tenant === 'string' ? flags.tenant : null
    const targetOrg = typeof flags.org === 'string' ? flags.org : null
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const orgFilter: Record<string, unknown> = {}
    if (targetOrg) orgFilter.id = targetOrg
    if (targetTenant) orgFilter.tenant = targetTenant
    const organizations = await em.find(Organization, orgFilter as Record<string, unknown>)
    let created = 0
    let existing = 0
    for (const org of organizations) {
      const tenantId = (org.tenant as unknown as { id?: string } | string | null)
      const tenantIdStr = typeof tenantId === 'string' ? tenantId : tenantId?.id ?? null
      if (!tenantIdStr) continue
      const result = await ensurePublicRoot(em, tenantIdStr, org.id)
      if (result === 'created') created += 1
      else existing += 1
    }
    console.log(`reports rebuild-folders: scanned ${organizations.length} organizations`)
    console.log(`  created: ${created}`)
    console.log(`  already-existed: ${existing}`)
  },
}

const listDatasetsCommand: ModuleCli = {
  command: 'list-datasets',
  async run() {
    const datasets = await listVisibleDatasets(new Set(['*']))
    if (datasets.length === 0) {
      console.log('No datasets declared. Add `<module>/reports.ts` declarations and run `yarn generate`.')
      return
    }
    console.log(`Declared datasets (${datasets.length}):`)
    for (const dataset of datasets) {
      const required = dataset.requiredFeatures && dataset.requiredFeatures.length
        ? ` requiredFeatures=[${dataset.requiredFeatures.join(', ')}]`
        : ''
      console.log(`  - ${dataset.id}\tmodule=${dataset.moduleId}${required}`)
      console.log(`      labelKey: ${dataset.labelKey}    entity: ${dataset.entityType}`)
      console.log(`      fields: ${dataset.fields.map((f) => f.key).join(', ')}`)
    }
  },
}

const runReportCommand: ModuleCli = {
  command: 'run',
  async run(argv) {
    const { positional, flags } = parseArgs(argv)
    const reportId = positional[0]
    if (!reportId) {
      console.error('Usage: mercato reports run <reportId> [--tenant <id>] [--org <id>] [--params <json>]')
      process.exitCode = 1
      return
    }
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const queryEngine = container.resolve('queryEngine') as QueryEngine

    const filter: Record<string, unknown> = { id: reportId, deletedAt: null }
    if (typeof flags.tenant === 'string') filter.tenantId = flags.tenant
    if (typeof flags.org === 'string') filter.organizationId = flags.org
    const report = await em.findOne(Report, filter)
    if (!report) {
      console.error(`Report '${reportId}' not found`)
      process.exitCode = 1
      return
    }

    const dataset = await loadDataset(report.datasetId, new Set(['*']))
    if (!dataset) {
      console.error(`Dataset '${report.datasetId}' not visible (CLI uses super-admin features)`)
      process.exitCode = 1
      return
    }

    let params: Record<string, unknown> = {}
    if (typeof flags.params === 'string') {
      try {
        const parsed = JSON.parse(flags.params)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          params = parsed as Record<string, unknown>
        } else {
          throw new Error('params must be a JSON object')
        }
      } catch (err) {
        console.error(`Invalid --params JSON: ${(err as Error).message}`)
        process.exitCode = 1
        return
      }
    }

    const definition = report.definitionJson as ReportDefinition
    const parameterDefs = (report.parametersJson as ParameterDef[] | undefined) ?? undefined
    const out = await executeReport(queryEngine, {
      dataset,
      definition,
      userFeatures: new Set(['*']),
      tenantId: report.tenantId,
      organizationId: report.organizationId,
      params,
      parameterDefs,
    })
    console.log(`Report ${report.name} (${report.id})`)
    console.log(`  type: ${report.type}    dataset: ${report.datasetId}`)
    console.log(`  rows: ${out.rows.length}    total: ${out.total}    duration: ${out.meta.duration_ms}ms`)
    if (out.meta.truncated) console.log(`  truncated at cap ${out.meta.cap}`)
    if (flags.json === true) {
      console.log(JSON.stringify({ rows: out.rows, meta: out.meta }, null, 2))
    } else {
      const preview = out.rows.slice(0, 10)
      if (preview.length > 0) {
        console.log('  first rows:')
        for (const row of preview) console.log('   ', JSON.stringify(row))
      }
      if (out.rows.length > preview.length) {
        console.log(`  …${out.rows.length - preview.length} more (pass --json for full output)`)
      }
    }
  },
}

export default [rebuildFoldersCommand, listDatasetsCommand, runReportCommand]
