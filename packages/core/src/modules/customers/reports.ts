import { defineDataset } from '@open-mercato/shared/modules/reports/dsl'

/**
 * Reports datasets exposed by the customers module.
 *
 * The customers module stores people and companies in a single
 * `customer_entities` table with a `kind` discriminator. Reports can
 * filter on `kind` to scope a report to people only or companies only.
 *
 * Email and phone are gated by `customers.view_pii` so that users without
 * that feature cannot project, filter, group, sort or aggregate over them.
 */
export const datasets = [
  defineDataset({
    id: 'customers.entities',
    moduleId: 'customers',
    labelKey: 'customers.reports.datasets.entities.label',
    descriptionKey: 'customers.reports.datasets.entities.description',
    entityType: 'customers:customer_entity',
    requiredFeatures: ['customers.people.view', 'customers.companies.view'],
    fields: [
      { key: 'id', labelKey: 'customers.fields.id', kind: 'id' },
      { key: 'kind', labelKey: 'customers.fields.kind', kind: 'enum', options: ['person', 'company'] },
      { key: 'display_name', labelKey: 'customers.fields.display_name', kind: 'text', aggregations: ['count', 'count_distinct'] },
      { key: 'status', labelKey: 'customers.fields.status', kind: 'enum' },
      { key: 'lifecycle_stage', labelKey: 'customers.fields.lifecycle_stage', kind: 'enum' },
      { key: 'source', labelKey: 'customers.fields.source', kind: 'enum' },
      { key: 'primary_email', labelKey: 'customers.fields.primary_email', kind: 'text' },
      { key: 'primary_phone', labelKey: 'customers.fields.primary_phone', kind: 'text' },
      { key: 'owner_user_id', labelKey: 'customers.fields.owner_user_id', kind: 'fk' },
      { key: 'is_active', labelKey: 'customers.fields.is_active', kind: 'boolean' },
      {
        key: 'next_interaction_at',
        labelKey: 'customers.fields.next_interaction_at',
        kind: 'datetime',
        aggregations: ['min', 'max', 'count'],
      },
      {
        key: 'created_at',
        labelKey: 'customers.fields.created_at',
        kind: 'datetime',
        aggregations: ['min', 'max', 'count'],
      },
      {
        key: 'updated_at',
        labelKey: 'customers.fields.updated_at',
        kind: 'datetime',
        aggregations: ['min', 'max', 'count'],
      },
    ],
    fieldAcl: {
      primary_email: ['customers.view_pii'],
      primary_phone: ['customers.view_pii'],
    },
    defaultSort: [{ field: 'created_at', dir: 'desc' }],
    defaultPageSize: 50,
  }),

  /**
   * Deals — sales pipeline opportunities. `title` is encrypted at rest
   * (customers/encryption.ts); the QueryEngine decrypts it on the way out.
   */
  defineDataset({
    id: 'customers.deals',
    moduleId: 'customers',
    labelKey: 'customers.reports.datasets.deals.label',
    descriptionKey: 'customers.reports.datasets.deals.description',
    entityType: 'customers:customer_deal',
    requiredFeatures: ['customers.deals.view'],
    fields: [
      { key: 'id', labelKey: 'customers.reports.fields.deal.id', kind: 'id' },
      { key: 'title', labelKey: 'customers.reports.fields.deal.title', kind: 'text', aggregations: ['count', 'count_distinct'] },
      {
        key: 'status',
        labelKey: 'customers.reports.fields.deal.status',
        kind: 'enum',
        options: ['open', 'won', 'lost'],
      },
      { key: 'pipeline_stage', labelKey: 'customers.reports.fields.deal.pipeline_stage', kind: 'enum' },
      { key: 'pipeline_id', labelKey: 'customers.reports.fields.deal.pipeline_id', kind: 'fk' },
      { key: 'pipeline_stage_id', labelKey: 'customers.reports.fields.deal.pipeline_stage_id', kind: 'fk' },
      {
        key: 'value_amount',
        labelKey: 'customers.reports.fields.deal.value_amount',
        kind: 'money',
        aggregations: ['sum', 'avg', 'min', 'max', 'count'],
      },
      { key: 'value_currency', labelKey: 'customers.reports.fields.deal.value_currency', kind: 'enum' },
      {
        key: 'probability',
        labelKey: 'customers.reports.fields.deal.probability',
        kind: 'integer',
        aggregations: ['avg', 'min', 'max'],
      },
      {
        key: 'expected_close_at',
        labelKey: 'customers.reports.fields.deal.expected_close_at',
        kind: 'datetime',
        aggregations: ['min', 'max', 'count'],
      },
      { key: 'owner_user_id', labelKey: 'customers.reports.fields.deal.owner_user_id', kind: 'fk' },
      { key: 'source', labelKey: 'customers.reports.fields.deal.source', kind: 'enum' },
      {
        key: 'closure_outcome',
        labelKey: 'customers.reports.fields.deal.closure_outcome',
        kind: 'enum',
        options: ['won', 'lost'],
      },
      { key: 'loss_reason_id', labelKey: 'customers.reports.fields.deal.loss_reason_id', kind: 'fk' },
      {
        key: 'created_at',
        labelKey: 'customers.reports.fields.deal.created_at',
        kind: 'datetime',
        aggregations: ['min', 'max', 'count'],
      },
      {
        key: 'updated_at',
        labelKey: 'customers.reports.fields.deal.updated_at',
        kind: 'datetime',
        aggregations: ['min', 'max', 'count'],
      },
    ],
    defaultSort: [{ field: 'created_at', dir: 'desc' }],
    defaultPageSize: 50,
  }),
]

export default datasets
