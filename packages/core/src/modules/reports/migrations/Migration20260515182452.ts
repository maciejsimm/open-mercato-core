import { Migration } from '@mikro-orm/migrations'

export class Migration20260515182452 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "reports_folders" (
        "id" uuid not null default gen_random_uuid(),
        "organization_id" uuid not null,
        "tenant_id" uuid not null,
        "parent_folder_id" uuid null,
        "owner_user_id" uuid null,
        "kind" text not null,
        "name" text not null,
        "position" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz null,
        "deleted_at" timestamptz null,
        constraint "reports_folders_pkey" primary key ("id"),
        constraint "reports_folders_kind_owner_chk" check (
          ("kind" = 'public' AND "owner_user_id" IS NULL)
          OR ("kind" = 'private' AND "owner_user_id" IS NOT NULL)
        )
      );`,
    )
    this.addSql(`create index "reports_folders_scope_idx" on "reports_folders" ("tenant_id", "organization_id", "parent_folder_id");`)
    this.addSql(`create index "reports_folders_owner_idx" on "reports_folders" ("owner_user_id");`)

    this.addSql(
      `create table "reports_folder_shares" (
        "id" uuid not null default gen_random_uuid(),
        "organization_id" uuid not null,
        "tenant_id" uuid not null,
        "folder_id" uuid not null,
        "principal_type" text not null,
        "principal_id" uuid not null,
        "permission" text not null,
        "granted_by_user_id" uuid not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz null,
        constraint "reports_folder_shares_pkey" primary key ("id")
      );`,
    )
    this.addSql(`create index "reports_folder_shares_folder_idx" on "reports_folder_shares" ("folder_id");`)
    this.addSql(`alter table "reports_folder_shares" add constraint "reports_folder_shares_uniq" unique ("folder_id", "principal_type", "principal_id");`)

    this.addSql(
      `create table "reports_reports" (
        "id" uuid not null default gen_random_uuid(),
        "organization_id" uuid not null,
        "tenant_id" uuid not null,
        "folder_id" uuid not null,
        "owner_user_id" uuid not null,
        "name" text not null,
        "description" text null,
        "type" text not null,
        "dataset_id" text not null,
        "definition_json" jsonb not null,
        "parameters_json" jsonb not null,
        "version" int not null default 1,
        "last_executed_at" timestamptz null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz null,
        "deleted_at" timestamptz null,
        constraint "reports_reports_pkey" primary key ("id")
      );`,
    )
    this.addSql(`create index "reports_reports_folder_idx" on "reports_reports" ("folder_id");`)
    this.addSql(`create index "reports_reports_owner_idx" on "reports_reports" ("owner_user_id");`)
    this.addSql(`create index "reports_reports_dataset_idx" on "reports_reports" ("dataset_id");`)
    this.addSql(`create unique index "reports_reports_folder_name_uniq" on "reports_reports" ("tenant_id","organization_id","folder_id","name") where "deleted_at" is null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "reports_reports" cascade;`)
    this.addSql(`drop table if exists "reports_folder_shares" cascade;`)
    this.addSql(`drop table if exists "reports_folders" cascade;`)
  }
}
