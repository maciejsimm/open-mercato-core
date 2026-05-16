import { Migration } from '@mikro-orm/migrations'

export class Migration20260516000004 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "reports_executions" (
        "id" uuid not null default gen_random_uuid(),
        "organization_id" uuid not null,
        "tenant_id" uuid not null,
        "report_id" uuid not null,
        "schedule_id" uuid null,
        "requested_by_user_id" uuid null,
        "params_hash" text not null,
        "status" text not null,
        "started_at" timestamptz not null,
        "completed_at" timestamptz null,
        "row_count" int null,
        "duration_ms" int null,
        "error_text" text null,
        "result_blob_id" uuid null,
        "created_at" timestamptz not null,
        constraint "reports_executions_pkey" primary key ("id")
      );`,
    )
    this.addSql(`create index "reports_executions_report_idx" on "reports_executions" ("report_id");`)
    this.addSql(`create index "reports_executions_schedule_idx" on "reports_executions" ("schedule_id");`)
    this.addSql(
      `create index "reports_executions_tenant_status_idx" on "reports_executions" ("tenant_id","status");`,
    )
    this.addSql(`create index "reports_executions_started_at_idx" on "reports_executions" ("started_at");`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "reports_executions" cascade;`)
  }
}
