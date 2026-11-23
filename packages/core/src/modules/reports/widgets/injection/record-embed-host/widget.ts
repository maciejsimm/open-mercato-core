import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import RecordEmbedHostWidget from './widget.client'

/**
 * Step 3.11 — record-embed-host widget.
 *
 * Renders configured `reports_embeds` rows on host spots. Reads
 * `paramBindings` of each embed and resolves them against the host
 * record (record-field source) plus any literal overrides, then runs
 * the underlying report or dashboard and renders the rows inline.
 *
 * Registered against every spot in `lib/embed-spots.ts` (customers person,
 * company and deal, sales order and quote, catalog product) through the
 * reports `widgets/injection-table.ts`; add a new host spot to both.
 */
const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'reports.injection.record-embed-host',
    title: 'Reports record embed host',
    description:
      'Renders reports / dashboards configured for the current host spot + entity. Resolves parameter bindings from the host record and runs the artifact via the standard run routes.',
    features: ['reports.view'],
    priority: 100,
    enabled: true,
  },
  Widget: RecordEmbedHostWidget,
}

export default widget
