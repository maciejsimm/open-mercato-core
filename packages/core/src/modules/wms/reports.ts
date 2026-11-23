import { defineDataset } from '@open-mercato/shared/modules/reports/dsl'

/**
 * Reports datasets exposed by the WMS module.
 *
 * `quantity_available` is a generated column (on hand − reserved − allocated)
 * that the inventory balances list API already exposes.
 */
export const datasets = [
  defineDataset({
    id: 'wms.inventory_balances',
    moduleId: 'wms',
    labelKey: 'wms.reports.datasets.inventory_balances.label',
    descriptionKey: 'wms.reports.datasets.inventory_balances.description',
    entityType: 'wms:inventory_balance',
    requiredFeatures: ['wms.view'],
    fields: [
      { key: 'id', labelKey: 'wms.reports.fields.inventory_balance.id', kind: 'id' },
      { key: 'warehouse_id', labelKey: 'wms.reports.fields.inventory_balance.warehouse_id', kind: 'fk' },
      { key: 'location_id', labelKey: 'wms.reports.fields.inventory_balance.location_id', kind: 'fk' },
      { key: 'catalog_variant_id', labelKey: 'wms.reports.fields.inventory_balance.catalog_variant_id', kind: 'fk' },
      { key: 'lot_id', labelKey: 'wms.reports.fields.inventory_balance.lot_id', kind: 'fk' },
      {
        key: 'serial_number',
        labelKey: 'wms.reports.fields.inventory_balance.serial_number',
        kind: 'text',
        aggregations: ['count', 'count_distinct'],
      },
      {
        key: 'quantity_on_hand',
        labelKey: 'wms.reports.fields.inventory_balance.quantity_on_hand',
        kind: 'float',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'quantity_reserved',
        labelKey: 'wms.reports.fields.inventory_balance.quantity_reserved',
        kind: 'float',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'quantity_allocated',
        labelKey: 'wms.reports.fields.inventory_balance.quantity_allocated',
        kind: 'float',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'quantity_available',
        labelKey: 'wms.reports.fields.inventory_balance.quantity_available',
        kind: 'float',
        aggregations: ['sum', 'avg', 'min', 'max'],
      },
      {
        key: 'created_at',
        labelKey: 'wms.reports.fields.inventory_balance.created_at',
        kind: 'datetime',
        aggregations: ['min', 'max', 'count'],
      },
      {
        key: 'updated_at',
        labelKey: 'wms.reports.fields.inventory_balance.updated_at',
        kind: 'datetime',
        aggregations: ['min', 'max', 'count'],
      },
    ],
    defaultSort: [{ field: 'updated_at', dir: 'desc' }],
    defaultPageSize: 50,
  }),
]

export default datasets
