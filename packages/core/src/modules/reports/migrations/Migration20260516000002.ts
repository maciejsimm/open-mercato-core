import { Migration } from '@mikro-orm/migrations'

export class Migration20260516000002 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "reports_embeds" (
        "id" uuid not null default gen_random_uuid(),
        "organization_id" uuid not null,
        "tenant_id" uuid not null,
        "host_spot_id" text not null,
        "host_entity_id" text not null,
        "artifact_type" text not null,
        "artifact_id" uuid not null,
        "param_bindings_json" jsonb not null default '{}'::jsonb,
        "display_title" text null,
        "position" int not null default 0,
        "enabled" boolean not null default true,
        "created_at" timestamptz not null,
        "updated_at" timestamptz null,
        "deleted_at" timestamptz null,
        constraint "reports_embeds_pkey" primary key ("id"),
        constraint "reports_embeds_artifact_type_chk" check ("artifact_type" in ('report','dashboard'))
      );`,
    )
    this.addSql(
      `create index "reports_embeds_spot_idx" on "reports_embeds" ("tenant_id","host_spot_id","host_entity_id") where "deleted_at" is null and "enabled" = true;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "reports_embeds" cascade;`)
  }
}
