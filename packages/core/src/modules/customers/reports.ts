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
]

export default datasets
