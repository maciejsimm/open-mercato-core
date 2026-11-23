import type { ModuleInjectionTable, ModuleInjectionSlot } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Reports module injection table.
 *
 * The `record-embed-host` widget renders configured embeds on record detail
 * pages: the `detail:<module>.<entity>:after-header` slots of the customers
 * (person, company, deal) and sales (order, quote) detail pages, and the
 * stacked `crud-form:catalog.product` slot at the top of the product form.
 * Every spot listed here must also be registered in `lib/embed-spots.ts`
 * (`__tests__/embed-spots.test.ts` keeps both in sync).
 */
const recordEmbedHost = (): ModuleInjectionSlot[] => [
  {
    widgetId: 'reports.injection.record-embed-host',
    priority: 100,
  },
]

export const injectionTable: ModuleInjectionTable = {
  'detail:customers.person:after-header': recordEmbedHost(),
  'detail:customers.company:after-header': recordEmbedHost(),
  'detail:customers.deal:after-header': recordEmbedHost(),
  'detail:sales.order:after-header': recordEmbedHost(),
  'detail:sales.quote:after-header': recordEmbedHost(),
  'crud-form:catalog.product': recordEmbedHost(),
}

export default injectionTable
