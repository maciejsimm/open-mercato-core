import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

/**
 * Tenant-data encryption for the reports module.
 *
 * Execution rows hold decrypted dataset values (async/export results) and
 * upstream error text, so they are encrypted at rest and read back through
 * `findOneWithDecryption`. The broader map in the spec (report / folder /
 * dashboard / schedule / embed names and JSON payloads) is a follow-up:
 * those columns are still read with plain ORM queries and name filters.
 */
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'reports:report_execution',
    fields: [
      { field: 'error_text' },
      { field: 'result_json' },
      { field: 'result_meta_json' },
    ],
  },
]

export default defaultEncryptionMaps
