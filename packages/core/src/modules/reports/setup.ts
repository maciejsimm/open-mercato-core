import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: [
      'reports.view',
      'reports.author',
      'reports.share',
      'reports.schedule',
      'reports.export',
      'reports.embed.manage',
      'reports.admin',
    ],
    employee: [
      'reports.view',
      'reports.author',
      'reports.schedule',
      'reports.export',
    ],
  },
}

export default setup
