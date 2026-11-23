import { defineDataset } from '@open-mercato/shared/modules/reports/dsl'

/**
 * Reports datasets exposed by the staff module.
 *
 * Time entries are gated by `staff.timesheets.view`; rate overrides are
 * additionally gated by `staff.timesheets.rates.view`.
 */
export const datasets = [
  defineDataset({
    id: 'staff.time_entries',
    moduleId: 'staff',
    labelKey: 'staff.reports.datasets.time_entries.label',
    descriptionKey: 'staff.reports.datasets.time_entries.description',
    entityType: 'staff:staff_time_entry',
    requiredFeatures: ['staff.timesheets.view'],
    fields: [
      { key: 'id', labelKey: 'staff.reports.fields.time_entry.id', kind: 'id' },
      { key: 'staff_member_id', labelKey: 'staff.reports.fields.time_entry.staff_member_id', kind: 'fk' },
      {
        key: 'date',
        labelKey: 'staff.reports.fields.time_entry.date',
        kind: 'date',
        aggregations: ['min', 'max', 'count'],
      },
      {
        key: 'duration_minutes',
        labelKey: 'staff.reports.fields.time_entry.duration_minutes',
        kind: 'integer',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'rounded_minutes',
        labelKey: 'staff.reports.fields.time_entry.rounded_minutes',
        kind: 'integer',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      { key: 'is_billable', labelKey: 'staff.reports.fields.time_entry.is_billable', kind: 'boolean' },
      { key: 'source', labelKey: 'staff.reports.fields.time_entry.source', kind: 'enum' },
      { key: 'time_project_id', labelKey: 'staff.reports.fields.time_entry.time_project_id', kind: 'fk' },
      { key: 'task_id', labelKey: 'staff.reports.fields.time_entry.task_id', kind: 'fk' },
      { key: 'customer_id', labelKey: 'staff.reports.fields.time_entry.customer_id', kind: 'fk' },
      { key: 'deal_id', labelKey: 'staff.reports.fields.time_entry.deal_id', kind: 'fk' },
      { key: 'order_id', labelKey: 'staff.reports.fields.time_entry.order_id', kind: 'fk' },
      {
        key: 'rate_override_amount',
        labelKey: 'staff.reports.fields.time_entry.rate_override_amount',
        kind: 'money',
        currencyField: 'rate_currency_code',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      { key: 'rate_currency_code', labelKey: 'staff.reports.fields.time_entry.rate_currency_code', kind: 'enum' },
      {
        key: 'created_at',
        labelKey: 'staff.reports.fields.time_entry.created_at',
        kind: 'datetime',
        aggregations: ['min', 'max', 'count'],
      },
    ],
    fieldAcl: {
      rate_override_amount: ['staff.timesheets.rates.view'],
      rate_currency_code: ['staff.timesheets.rates.view'],
    },
    defaultSort: [{ field: 'date', dir: 'desc' }],
    defaultPageSize: 50,
  }),
]

export default datasets
