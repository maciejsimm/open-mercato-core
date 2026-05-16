import { defineDataset } from '@open-mercato/shared/modules/reports/dsl'

/**
 * Reports datasets exposed by the catalog module.
 *
 * Each row is one `catalog_products` record (the product header). Pricing,
 * variants, options, and category assignments live in separate tables and
 * are reported on via their own future datasets — `joins` are declared in
 * the DSL but not yet wired through the executor (Phase 1 limitation), so
 * for now this dataset stays flat.
 */
export const datasets = [
  defineDataset({
    id: 'catalog.products',
    moduleId: 'catalog',
    labelKey: 'catalog.reports.datasets.products.label',
    descriptionKey: 'catalog.reports.datasets.products.description',
    entityType: 'catalog:catalog_product',
    requiredFeatures: ['catalog.products.view'],
    fields: [
      { key: 'id', labelKey: 'catalog.reports.fields.product.id', kind: 'id' },
      {
        key: 'title',
        labelKey: 'catalog.reports.fields.product.title',
        kind: 'text',
        aggregations: ['count', 'count_distinct'],
      },
      { key: 'subtitle', labelKey: 'catalog.reports.fields.product.subtitle', kind: 'text' },
      { key: 'sku', labelKey: 'catalog.reports.fields.product.sku', kind: 'text', aggregations: ['count', 'count_distinct'] },
      { key: 'handle', labelKey: 'catalog.reports.fields.product.handle', kind: 'text' },
      {
        key: 'product_type',
        labelKey: 'catalog.reports.fields.product.product_type',
        kind: 'enum',
        options: ['simple', 'configurable', 'bundle', 'service'],
      },
      {
        key: 'status',
        labelKey: 'catalog.reports.fields.product.status',
        kind: 'enum',
      },
      {
        key: 'tax_rate',
        labelKey: 'catalog.reports.fields.product.tax_rate',
        kind: 'float',
        aggregations: ['avg', 'min', 'max'],
      },
      { key: 'primary_currency_code', labelKey: 'catalog.reports.fields.product.primary_currency_code', kind: 'enum' },
      { key: 'default_unit', labelKey: 'catalog.reports.fields.product.default_unit', kind: 'enum' },
      { key: 'default_sales_unit', labelKey: 'catalog.reports.fields.product.default_sales_unit', kind: 'enum' },
      {
        key: 'default_sales_unit_quantity',
        labelKey: 'catalog.reports.fields.product.default_sales_unit_quantity',
        kind: 'float',
        aggregations: ['avg', 'min', 'max'],
      },
      {
        key: 'unit_price_enabled',
        labelKey: 'catalog.reports.fields.product.unit_price_enabled',
        kind: 'boolean',
      },
      {
        key: 'weight_value',
        labelKey: 'catalog.reports.fields.product.weight_value',
        kind: 'float',
        aggregations: ['avg', 'min', 'max', 'sum'],
      },
      { key: 'weight_unit', labelKey: 'catalog.reports.fields.product.weight_unit', kind: 'enum' },
      {
        key: 'created_at',
        labelKey: 'catalog.reports.fields.product.created_at',
        kind: 'datetime',
        aggregations: ['min', 'max', 'count'],
      },
      {
        key: 'updated_at',
        labelKey: 'catalog.reports.fields.product.updated_at',
        kind: 'datetime',
        aggregations: ['min', 'max', 'count'],
      },
    ],
    defaultSort: [{ field: 'created_at', dir: 'desc' }],
    defaultPageSize: 50,
  }),
]

export default datasets
