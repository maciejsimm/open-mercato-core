import { defineDataset } from '@open-mercato/shared/modules/reports/dsl'

/**
 * Reports datasets exposed by the sales module.
 *
 * We expose four datasets because the reports runtime does not yet wire
 * `joins` through the executor (Phase 1 of the spec). Each dataset is
 * therefore flat over a single table. To analyse "orders with line items",
 * authors build either:
 *   - an `orders` summary (header rows with grand totals), or
 *   - a `order_lines` report grouped by `order_id` (one row per line; the
 *     line table already denormalises `name`, `currency_code`, prices, and
 *     status from the line itself).
 *
 * The `customer_entity_id` field is exposed as a `fk` so it can be filtered
 * by id — joining back to `customers.entities` for human-friendly labels
 * will land once the joins runtime ships.
 */
export const datasets = [
  defineDataset({
    id: 'sales.orders',
    moduleId: 'sales',
    labelKey: 'sales.reports.datasets.orders.label',
    descriptionKey: 'sales.reports.datasets.orders.description',
    entityType: 'sales:sales_order',
    requiredFeatures: ['sales.orders.view'],
    fields: [
      { key: 'id', labelKey: 'sales.reports.fields.order.id', kind: 'id' },
      {
        key: 'order_number',
        labelKey: 'sales.reports.fields.order.order_number',
        kind: 'text',
        aggregations: ['count', 'count_distinct'],
      },
      { key: 'external_reference', labelKey: 'sales.reports.fields.order.external_reference', kind: 'text' },
      { key: 'customer_reference', labelKey: 'sales.reports.fields.order.customer_reference', kind: 'text' },
      { key: 'customer_entity_id', labelKey: 'sales.reports.fields.order.customer_entity_id', kind: 'fk' },
      { key: 'customer_contact_id', labelKey: 'sales.reports.fields.order.customer_contact_id', kind: 'fk' },
      { key: 'currency_code', labelKey: 'sales.reports.fields.order.currency_code', kind: 'enum' },
      { key: 'status', labelKey: 'sales.reports.fields.order.status', kind: 'enum' },
      { key: 'fulfillment_status', labelKey: 'sales.reports.fields.order.fulfillment_status', kind: 'enum' },
      { key: 'payment_status', labelKey: 'sales.reports.fields.order.payment_status', kind: 'enum' },
      {
        key: 'subtotal_net_amount',
        labelKey: 'sales.reports.fields.order.subtotal_net_amount',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'subtotal_gross_amount',
        labelKey: 'sales.reports.fields.order.subtotal_gross_amount',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'grand_total_net_amount',
        labelKey: 'sales.reports.fields.order.grand_total_net_amount',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'grand_total_gross_amount',
        labelKey: 'sales.reports.fields.order.grand_total_gross_amount',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'placed_at',
        labelKey: 'sales.reports.fields.order.placed_at',
        kind: 'datetime',
        aggregations: ['min', 'max', 'count'],
      },
      {
        key: 'created_at',
        labelKey: 'sales.reports.fields.order.created_at',
        kind: 'datetime',
        aggregations: ['min', 'max', 'count'],
      },
      {
        key: 'updated_at',
        labelKey: 'sales.reports.fields.order.updated_at',
        kind: 'datetime',
        aggregations: ['min', 'max', 'count'],
      },
    ],
    defaultSort: [{ field: 'placed_at', dir: 'desc' }],
    defaultPageSize: 50,
  }),

  defineDataset({
    id: 'sales.order_lines',
    moduleId: 'sales',
    labelKey: 'sales.reports.datasets.order_lines.label',
    descriptionKey: 'sales.reports.datasets.order_lines.description',
    entityType: 'sales:sales_order_line',
    requiredFeatures: ['sales.orders.view'],
    fields: [
      { key: 'id', labelKey: 'sales.reports.fields.order_line.id', kind: 'id' },
      { key: 'order_id', labelKey: 'sales.reports.fields.order_line.order_id', kind: 'fk' },
      {
        key: 'line_number',
        labelKey: 'sales.reports.fields.order_line.line_number',
        kind: 'integer',
        aggregations: ['count', 'max'],
      },
      {
        key: 'kind',
        labelKey: 'sales.reports.fields.order_line.kind',
        kind: 'enum',
        options: ['product', 'shipping', 'service', 'discount', 'manual'],
      },
      { key: 'status', labelKey: 'sales.reports.fields.order_line.status', kind: 'enum' },
      { key: 'product_id', labelKey: 'sales.reports.fields.order_line.product_id', kind: 'fk' },
      { key: 'product_variant_id', labelKey: 'sales.reports.fields.order_line.product_variant_id', kind: 'fk' },
      { key: 'name', labelKey: 'sales.reports.fields.order_line.name', kind: 'text', aggregations: ['count', 'count_distinct'] },
      {
        key: 'quantity',
        labelKey: 'sales.reports.fields.order_line.quantity',
        kind: 'float',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      { key: 'quantity_unit', labelKey: 'sales.reports.fields.order_line.quantity_unit', kind: 'enum' },
      {
        key: 'fulfilled_quantity',
        labelKey: 'sales.reports.fields.order_line.fulfilled_quantity',
        kind: 'float',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'invoiced_quantity',
        labelKey: 'sales.reports.fields.order_line.invoiced_quantity',
        kind: 'float',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'returned_quantity',
        labelKey: 'sales.reports.fields.order_line.returned_quantity',
        kind: 'float',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      { key: 'currency_code', labelKey: 'sales.reports.fields.order_line.currency_code', kind: 'enum' },
      {
        key: 'unit_price_net',
        labelKey: 'sales.reports.fields.order_line.unit_price_net',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['avg', 'min', 'max'],
      },
      {
        key: 'unit_price_gross',
        labelKey: 'sales.reports.fields.order_line.unit_price_gross',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['avg', 'min', 'max'],
      },
      {
        key: 'discount_amount',
        labelKey: 'sales.reports.fields.order_line.discount_amount',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'tax_amount',
        labelKey: 'sales.reports.fields.order_line.tax_amount',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'total_net_amount',
        labelKey: 'sales.reports.fields.order_line.total_net_amount',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'total_gross_amount',
        labelKey: 'sales.reports.fields.order_line.total_gross_amount',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
    ],
    defaultSort: [
      { field: 'order_id', dir: 'asc' },
      { field: 'line_number', dir: 'asc' },
    ],
    defaultPageSize: 50,
  }),

  defineDataset({
    id: 'sales.quotes',
    moduleId: 'sales',
    labelKey: 'sales.reports.datasets.quotes.label',
    descriptionKey: 'sales.reports.datasets.quotes.description',
    entityType: 'sales:sales_quote',
    requiredFeatures: ['sales.quotes.view'],
    fields: [
      { key: 'id', labelKey: 'sales.reports.fields.quote.id', kind: 'id' },
      {
        key: 'quote_number',
        labelKey: 'sales.reports.fields.quote.quote_number',
        kind: 'text',
        aggregations: ['count', 'count_distinct'],
      },
      { key: 'external_reference', labelKey: 'sales.reports.fields.quote.external_reference', kind: 'text' },
      { key: 'customer_reference', labelKey: 'sales.reports.fields.quote.customer_reference', kind: 'text' },
      { key: 'customer_entity_id', labelKey: 'sales.reports.fields.quote.customer_entity_id', kind: 'fk' },
      { key: 'customer_contact_id', labelKey: 'sales.reports.fields.quote.customer_contact_id', kind: 'fk' },
      { key: 'currency_code', labelKey: 'sales.reports.fields.quote.currency_code', kind: 'enum' },
      { key: 'status', labelKey: 'sales.reports.fields.quote.status', kind: 'enum' },
      {
        key: 'subtotal_net_amount',
        labelKey: 'sales.reports.fields.quote.subtotal_net_amount',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'subtotal_gross_amount',
        labelKey: 'sales.reports.fields.quote.subtotal_gross_amount',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'grand_total_net_amount',
        labelKey: 'sales.reports.fields.quote.grand_total_net_amount',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'grand_total_gross_amount',
        labelKey: 'sales.reports.fields.quote.grand_total_gross_amount',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      { key: 'converted_order_id', labelKey: 'sales.reports.fields.quote.converted_order_id', kind: 'fk' },
      {
        key: 'valid_from',
        labelKey: 'sales.reports.fields.quote.valid_from',
        kind: 'datetime',
        aggregations: ['min', 'max'],
      },
      {
        key: 'valid_until',
        labelKey: 'sales.reports.fields.quote.valid_until',
        kind: 'datetime',
        aggregations: ['min', 'max'],
      },
      {
        key: 'placed_at',
        labelKey: 'sales.reports.fields.quote.placed_at',
        kind: 'datetime',
        aggregations: ['min', 'max', 'count'],
      },
      {
        key: 'created_at',
        labelKey: 'sales.reports.fields.quote.created_at',
        kind: 'datetime',
        aggregations: ['min', 'max', 'count'],
      },
      {
        key: 'updated_at',
        labelKey: 'sales.reports.fields.quote.updated_at',
        kind: 'datetime',
        aggregations: ['min', 'max', 'count'],
      },
    ],
    defaultSort: [{ field: 'created_at', dir: 'desc' }],
    defaultPageSize: 50,
  }),

  defineDataset({
    id: 'sales.quote_lines',
    moduleId: 'sales',
    labelKey: 'sales.reports.datasets.quote_lines.label',
    descriptionKey: 'sales.reports.datasets.quote_lines.description',
    entityType: 'sales:sales_quote_line',
    requiredFeatures: ['sales.quotes.view'],
    fields: [
      { key: 'id', labelKey: 'sales.reports.fields.quote_line.id', kind: 'id' },
      { key: 'quote_id', labelKey: 'sales.reports.fields.quote_line.quote_id', kind: 'fk' },
      {
        key: 'line_number',
        labelKey: 'sales.reports.fields.quote_line.line_number',
        kind: 'integer',
        aggregations: ['count', 'max'],
      },
      {
        key: 'kind',
        labelKey: 'sales.reports.fields.quote_line.kind',
        kind: 'enum',
        options: ['product', 'shipping', 'service', 'discount', 'manual'],
      },
      { key: 'status', labelKey: 'sales.reports.fields.quote_line.status', kind: 'enum' },
      { key: 'product_id', labelKey: 'sales.reports.fields.quote_line.product_id', kind: 'fk' },
      { key: 'product_variant_id', labelKey: 'sales.reports.fields.quote_line.product_variant_id', kind: 'fk' },
      { key: 'name', labelKey: 'sales.reports.fields.quote_line.name', kind: 'text', aggregations: ['count', 'count_distinct'] },
      {
        key: 'quantity',
        labelKey: 'sales.reports.fields.quote_line.quantity',
        kind: 'float',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      { key: 'quantity_unit', labelKey: 'sales.reports.fields.quote_line.quantity_unit', kind: 'enum' },
      { key: 'currency_code', labelKey: 'sales.reports.fields.quote_line.currency_code', kind: 'enum' },
      {
        key: 'unit_price_net',
        labelKey: 'sales.reports.fields.quote_line.unit_price_net',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['avg', 'min', 'max'],
      },
      {
        key: 'unit_price_gross',
        labelKey: 'sales.reports.fields.quote_line.unit_price_gross',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['avg', 'min', 'max'],
      },
      {
        key: 'discount_amount',
        labelKey: 'sales.reports.fields.quote_line.discount_amount',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'tax_amount',
        labelKey: 'sales.reports.fields.quote_line.tax_amount',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'total_net_amount',
        labelKey: 'sales.reports.fields.quote_line.total_net_amount',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'total_gross_amount',
        labelKey: 'sales.reports.fields.quote_line.total_gross_amount',
        kind: 'money',
        currencyField: 'currency_code',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
    ],
    defaultSort: [
      { field: 'quote_id', dir: 'asc' },
      { field: 'line_number', dir: 'asc' },
    ],
    defaultPageSize: 50,
  }),
]

export default datasets
