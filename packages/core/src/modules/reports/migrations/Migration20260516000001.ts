import { Migration } from '@mikro-orm/migrations'

export class Migration20260516000001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "reports_dashboards" (
        "id" uuid not null default gen_random_uuid(),
        "organization_id" uuid not null,
        "tenant_id" uuid not null,
        "folder_id" uuid not null,
        "owner_user_id" uuid not null,
        "name" text not null,
        "description" text null,
        "layout_json" jsonb not null,
        "parameters_json" jsonb not null,
        "version" int not null default 1,
        "last_executed_at" timestamptz null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz null,
        "deleted_at" timestamptz null,
        constraint "reports_dashboards_pkey" primary key ("id")
      );`,
    )
    this.addSql(`create index "reports_dashboards_folder_idx" on "reports_dashboards" ("folder_id");`)
    this.addSql(`create index "reports_dashboards_owner_idx" on "reports_dashboards" ("owner_user_id");`)
    this.addSql(
      `create unique index "reports_dashboards_folder_name_uniq" on "reports_dashboards" ("tenant_id","organization_id","folder_id","name") where "deleted_at" is null;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "reports_dashboards" cascade;`)
  }
}
