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

@Entity({ tableName: 'reports_embeds' })
@Index({
  name: 'reports_embeds_spot_idx',
  expression:
    'create index "reports_embeds_spot_idx" on "reports_embeds" ("tenant_id","host_spot_id","host_entity_id") where "deleted_at" is null and "enabled" = true',
})
export class ReportEmbed {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'host_spot_id', type: 'text' })
  hostSpotId!: string

  @Property({ name: 'host_entity_id', type: 'text' })
  hostEntityId!: string

  @Property({ name: 'artifact_type', type: 'text' })
  artifactType!: 'report' | 'dashboard'

  @Property({ name: 'artifact_id', type: 'uuid' })
  artifactId!: string

  @Property({ name: 'param_bindings_json', type: 'json' })
  paramBindingsJson: unknown = {}

  @Property({ name: 'display_title', type: 'text', nullable: true })
  displayTitle?: string | null

  @Property({ name: 'position', type: 'int', default: 0 })
  position: number = 0

  @Property({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'reports_schedules' })
@Index({ name: 'reports_schedules_report_idx', properties: ['reportId'] })
@Index({
  name: 'reports_schedules_next_run_idx',
  expression:
    'create index "reports_schedules_next_run_idx" on "reports_schedules" ("next_run_at","enabled") where "deleted_at" is null',
})
export class ReportSchedule {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'report_id', type: 'uuid' })
  reportId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  cadence!: string

  @Property({ type: 'text' })
  timezone!: string

  @Property({ name: 'recipients_json', type: 'json' })
  recipientsJson: unknown = []

  @Property({ name: 'params_json', type: 'json' })
  paramsJson: unknown = {}

  @Property({ name: 'formats_json', type: 'json' })
  formatsJson: unknown = ['csv']

  @Property({ type: 'boolean', default: true })
  enabled: boolean = true

  @Property({ name: 'last_run_at', type: Date, nullable: true })
  lastRunAt?: Date | null

  @Property({ name: 'next_run_at', type: Date, nullable: true })
  nextRunAt?: Date | null

  @Property({ name: 'failure_count', type: 'int', default: 0 })
  failureCount: number = 0

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

@Entity({ tableName: 'reports_executions' })
@Index({ name: 'reports_executions_report_idx', properties: ['reportId'] })
@Index({ name: 'reports_executions_schedule_idx', properties: ['scheduleId'] })
@Index({ name: 'reports_executions_tenant_status_idx', properties: ['tenantId', 'status'] })
@Index({ name: 'reports_executions_started_at_idx', properties: ['startedAt'] })
export class ReportExecution {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'report_id', type: 'uuid' })
  reportId!: string

  @Property({ name: 'schedule_id', type: 'uuid', nullable: true })
  scheduleId?: string | null

  @Property({ name: 'requested_by_user_id', type: 'uuid', nullable: true })
  requestedByUserId?: string | null

  @Property({ name: 'params_hash', type: 'text' })
  paramsHash!: string

  @Property({ type: 'text' })
  status!: 'running' | 'completed' | 'failed' | 'cancelled'

  @Property({ name: 'started_at', type: Date })
  startedAt!: Date

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  @Property({ name: 'row_count', type: 'int', nullable: true })
  rowCount?: number | null

  @Property({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs?: number | null

  @Property({ name: 'error_text', type: 'text', nullable: true })
  errorText?: string | null

  @Property({ name: 'result_blob_id', type: 'uuid', nullable: true })
  resultBlobId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
