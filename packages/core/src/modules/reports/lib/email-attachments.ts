import type { EmailAttachment } from '@open-mercato/shared/lib/email/send'
import type { ReportSerializedExport } from './export'

/** Aggregate attachment ceiling per email (`OM_REPORTS_EMAIL_ATTACHMENT_MAX_BYTES`, default 10 MB). */
export function readAttachmentLimitBytes(): number {
  const raw = process.env.OM_REPORTS_EMAIL_ATTACHMENT_MAX_BYTES
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10 * 1024 * 1024
}

export type BuiltAttachments = {
  attachments: EmailAttachment[]
  /** Formats left out because the aggregate size exceeded the limit (delivered as an in-app link). */
  omitted: string[]
}

/**
 * Turn serialized exports into email attachments. Content is base64 — the
 * convention outbound channel adapters expect for attachments. Anything
 * over the aggregate limit is omitted and the email links to the in-app
 * download instead.
 */
export function buildEmailAttachments(
  baseName: string,
  artifacts: ReadonlyArray<ReportSerializedExport>,
  limitBytes = readAttachmentLimitBytes(),
): BuiltAttachments {
  const attachments: EmailAttachment[] = []
  const omitted: string[] = []
  let used = 0
  const safeBase = baseName.replace(/[^a-z0-9_\-]/gi, '_') || 'report'
  for (const artifact of artifacts) {
    const buffer = typeof artifact.body === 'string' ? Buffer.from(artifact.body, 'utf8') : artifact.body
    if (used + buffer.length > limitBytes) {
      omitted.push(artifact.fileExtension)
      continue
    }
    used += buffer.length
    attachments.push({
      filename: `${safeBase}.${artifact.fileExtension}`,
      content: buffer.toString('base64'),
      contentType: artifact.contentType,
    })
  }
  return { attachments, omitted }
}
