import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'reports',
  title: 'Reports & Analytics',
  version: '0.1.0',
  description:
    'Self-serve reports and analytical dashboards over indexed entities. Datasets are declared in each module\'s reports.ts file; users compose flat-list, grouped, pivot, chart and summary reports with field-level RBAC, parameters, schedules, and embeds.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  ejectable: true,
}

export { features } from './acl'
