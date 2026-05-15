import { Entity, PrimaryKey, Property, Index, Unique, Check } from '@mikro-orm/decorators/legacy'

@Entity({ tableName: 'reports_folders' })
@Index({ name: 'reports_folders_scope_idx', properties: ['tenantId', 'organizationId', 'parentFolderId'] })
@Index({ name: 'reports_folders_owner_idx', properties: ['ownerUserId'] })
@Check({ name: 'reports_folders_kind_owner_chk', expression: `("kind" = 'public' AND "owner_user_id" IS NULL) OR ("kind" = 'private' AND "owner_user_id" IS NOT NULL)` })
export class ReportFolder {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'parent_folder_id', type: 'uuid', nullable: true })
  parentFolderId?: string | null

  @Property({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId?: string | null

  @Property({ type: 'text' })
  kind!: 'private' | 'public'

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'position', type: 'int', default: 0 })
  position: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'reports_folder_shares' })
@Index({ name: 'reports_folder_shares_folder_idx', properties: ['folderId'] })
@Unique({ name: 'reports_folder_shares_uniq', properties: ['folderId', 'principalType', 'principalId'] })
export class ReportFolderShare {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'folder_id', type: 'uuid' })
  folderId!: string

  @Property({ name: 'principal_type', type: 'text' })
  principalType!: 'user' | 'role'

  @Property({ name: 'principal_id', type: 'uuid' })
  principalId!: string

  @Property({ type: 'text' })
  permission!: 'view' | 'edit'

  @Property({ name: 'granted_by_user_id', type: 'uuid' })
  grantedByUserId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null
}

@Entity({ tableName: 'reports_dashboards' })
@Index({ name: 'reports_dashboards_folder_idx', properties: ['folderId'] })
@Index({ name: 'reports_dashboards_owner_idx', properties: ['ownerUserId'] })
@Unique({
  name: 'reports_dashboards_folder_name_uniq',
  expression:
    'create unique index "reports_dashboards_folder_name_uniq" on "reports_dashboards" ("tenant_id","organization_id","folder_id","name") where "deleted_at" is null',
})
export class ReportDashboard {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'folder_id', type: 'uuid' })
  folderId!: string

  @Property({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'layout_json', type: 'json' })
  layoutJson!: unknown

  @Property({ name: 'parameters_json', type: 'json' })
  parametersJson: unknown = []

  @Property({ name: 'version', type: 'int', default: 1 })
  version: number = 1

  @Property({ name: 'last_executed_at', type: Date, nullable: true })
  lastExecutedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'reports_reports' })
@Index({ name: 'reports_reports_folder_idx', properties: ['folderId'] })
@Index({ name: 'reports_reports_owner_idx', properties: ['ownerUserId'] })
@Index({ name: 'reports_reports_dataset_idx', properties: ['datasetId'] })
@Unique({
  name: 'reports_reports_folder_name_uniq',
  expression:
    'create unique index "reports_reports_folder_name_uniq" on "reports_reports" ("tenant_id","organization_id","folder_id","name") where "deleted_at" is null',
})
export class Report {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'folder_id', type: 'uuid' })
  folderId!: string

  @Property({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'text' })
  type!: 'flat_list' | 'grouped' | 'pivot' | 'chart' | 'summary'

  @Property({ name: 'dataset_id', type: 'text' })
  datasetId!: string

  @Property({ name: 'definition_json', type: 'json' })
  definitionJson!: unknown

  @Property({ name: 'parameters_json', type: 'json' })
  parametersJson: unknown = []

  @Property({ name: 'version', type: 'int', default: 1 })
  version: number = 1

  @Property({ name: 'last_executed_at', type: Date, nullable: true })
  lastExecutedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
