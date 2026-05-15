import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Reports module injection table.
 *
 * The `record-embed-host` widget (Step 3.11) renders configured embeds on
 * the customers detail pages where Step 3.10 added the
 * `detail:customers.{person,company}:after-header` injection spots. Other
 * modules can subscribe to the widget by adding an entry under their own
 * `detail:<module>.<entity>:after-header` slot.
 */
export const injectionTable: ModuleInjectionTable = {
  'detail:customers.person:after-header': [
    {
      widgetId: 'reports.injection.record-embed-host',
      priority: 100,
    },
  ],
  'detail:customers.company:after-header': [
    {
      widgetId: 'reports.injection.record-embed-host',
      priority: 100,
    },
  ],
}

export default injectionTable
