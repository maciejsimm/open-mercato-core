import { Migration } from '@mikro-orm/migrations'
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill'
import { defaultEncryptionMaps } from '../encryption'

export class Migration20261123120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "reports_executions" add column if not exists "result_json" jsonb null;`)
    this.addSql(`alter table "reports_executions" add column if not exists "result_meta_json" jsonb null;`)
    this.addSql(`alter table "reports_schedules" add column if not exists "owner_user_id" uuid null;`)
    for (const map of defaultEncryptionMaps) {
      this.addSql(buildEncryptionMapBackfillSql(map))
    }
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "reports_schedules" drop column if exists "owner_user_id";`)
    this.addSql(`alter table "reports_executions" drop column if exists "result_meta_json";`)
    this.addSql(`alter table "reports_executions" drop column if exists "result_json";`)
  }
}
