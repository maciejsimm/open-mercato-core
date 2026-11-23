import { resolvePageRouteMetadata, type PageMetadata } from '@open-mercato/shared/modules/registry'
import { buildAdminNav, type AdminNavItem } from '@open-mercato/ui/backend/utils/nav'
import { metadata as reportsList } from '../backend/page.meta'
import { metadata as reportDetail } from '../backend/reports/[id]/page.meta'
import { metadata as reportNew } from '../backend/reports/new/page.meta'
import { metadata as dashboardsList } from '../backend/reports/dashboards/page.meta'
import { metadata as dashboardDetail } from '../backend/reports/dashboards/[id]/page.meta'
import { metadata as dashboardNew } from '../backend/reports/dashboards/new/page.meta'
import { metadata as embedsList } from '../backend/reports/embeds/page.meta'
import { metadata as embedNew } from '../backend/reports/embeds/new/page.meta'
import { metadata as schedulesList } from '../backend/reports/schedules/page.meta'
import { metadata as scheduleNew } from '../backend/reports/schedules/new/page.meta'

type NavModule = Parameters<typeof buildAdminNav>[0][number]

const pages: Array<[string, PageMetadata]> = [
  ['/backend/reports', reportsList],
  ['/backend/reports/[id]', reportDetail],
  ['/backend/reports/new', reportNew],
  ['/backend/reports/dashboards', dashboardsList],
  ['/backend/reports/dashboards/[id]', dashboardDetail],
  ['/backend/reports/dashboards/new', dashboardNew],
  ['/backend/reports/embeds', embedsList],
  ['/backend/reports/embeds/new', embedNew],
  ['/backend/reports/schedules', schedulesList],
  ['/backend/reports/schedules/new', scheduleNew],
]

const reportsModule = {
  id: 'reports',
  backendRoutes: pages.map(([pattern, metadata]) => resolvePageRouteMetadata(pattern, metadata)),
} as NavModule

const otherModule = {
  id: 'customers',
  backendRoutes: [resolvePageRouteMetadata('/backend/customers/people', { pageTitle: 'People', pageOrder: 10 })],
} as NavModule

function outline(items: AdminNavItem[]): Array<{ href: string; children?: string[] }> {
  return items.map((item) => (item.children?.length
    ? { href: item.href, children: item.children.map((child) => child.href) }
    : { href: item.href }))
}

async function buildNav(path: string) {
  return buildAdminNav([otherModule, reportsModule], { auth: { roles: [] }, path }, [], (_key, fallback) => fallback, {
    checkFeatures: async () => ['reports.*', 'customers.*'],
  })
}

describe('reports sidebar structure (F18)', () => {
  it.each(['/backend/customers/people', '/backend/reports'])('renders Reports then Dashboards with list-page children from %s', async (path) => {
    const nav = await buildNav(path)
    const reportsGroup = nav.filter((item) => item.groupId === 'Reports')
    expect(outline(reportsGroup)).toEqual([
      { href: '/backend/reports', children: ['/backend/reports/embeds', '/backend/reports/schedules'] },
      { href: '/backend/reports/dashboards' },
    ])
  })

  it('never lists create pages', async () => {
    const nav = await buildNav('/backend/reports')
    const hrefs = nav.flatMap((item) => [item.href, ...(item.children ?? []).map((child) => child.href)])
    for (const created of ['/backend/reports/new', '/backend/reports/dashboards/new', '/backend/reports/embeds/new', '/backend/reports/schedules/new']) {
      expect(hrefs).not.toContain(created)
    }
  })

  it('keeps pageParent through resolvePageRouteMetadata', () => {
    const resolved = resolvePageRouteMetadata('/backend/reports/embeds', embedsList)
    expect(resolved.pageParent).toBe('/backend/reports')
    expect(resolvePageRouteMetadata('/backend/reports/dashboards', dashboardsList).pageParent).toBeNull()
  })
})
