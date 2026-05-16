import { Migration } from '@mikro-orm/migrations'

export class Migration20260516000003 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "reports_schedules" (
        "id" uuid not null default gen_random_uuid(),
        "organization_id" uuid not null,
        "tenant_id" uuid not null,
        "report_id" uuid not null,
        "name" text not null,
        "cadence" text not null,
        "timezone" text not null,
        "recipients_json" jsonb not null default '[]'::jsonb,
        "params_json" jsonb not null default '{}'::jsonb,
        "formats_json" jsonb not null default '["csv"]'::jsonb,
        "enabled" boolean not null default true,
        "last_run_at" timestamptz null,
        "next_run_at" timestamptz null,
        "failure_count" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz null,
        "deleted_at" timestamptz null,
        constraint "reports_schedules_pkey" primary key ("id")
      );`,
    )
    this.addSql(`create index "reports_schedules_report_idx" on "reports_schedules" ("report_id");`)
    this.addSql(
      `create index "reports_schedules_next_run_idx" on "reports_schedules" ("next_run_at","enabled") where "deleted_at" is null;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "reports_schedules" cascade;`)
  }
}
