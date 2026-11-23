import * as React from 'react'
import { Html, Head, Preview, Body, Container, Text, Section, Link } from '@react-email/components'

export type ScheduledReportEmailCopy = {
  preview: string
  title: string
  summary: string
  attachmentsNote: string
  cta: string
  footer: string
}

export type ScheduledReportEmailProps = {
  copy: ScheduledReportEmailCopy
  /** Formatted header + up to a handful of preview rows (already formatted by `formatReportValue`). */
  previewTable?: { headers: string[]; rows: string[][] }
  reportUrl?: string
}

export function ScheduledReportEmail({ copy, previewTable, reportUrl }: ScheduledReportEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{copy.preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section>
            <Text style={title}>{copy.title}</Text>
            <Text style={paragraph}>{copy.summary}</Text>
            {previewTable && previewTable.rows.length > 0 ? (
              <table style={table} cellPadding={0} cellSpacing={0}>
                <thead>
                  <tr>
                    {previewTable.headers.map((header, idx) => (
                      <th key={idx} style={th}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewTable.rows.map((row, rowIdx) => (
                    <tr key={rowIdx}>
                      {row.map((cell, cellIdx) => (
                        <td key={cellIdx} style={td}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <Text style={paragraph}>{copy.attachmentsNote}</Text>
            {reportUrl ? (
              <Text>
                <Link href={reportUrl} style={button}>{copy.cta}</Link>
              </Text>
            ) : null}
            <Text style={hint}>{copy.footer}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

const body: React.CSSProperties = { backgroundColor: '#f9fafb', margin: 0, padding: '24px 0' }
const container: React.CSSProperties = { backgroundColor: '#ffffff', borderRadius: 12, padding: 24, margin: '0 auto', maxWidth: 640 }
const title: React.CSSProperties = { fontSize: 20, fontWeight: 600, color: '#111827', margin: '0 0 12px' }
const paragraph: React.CSSProperties = { fontSize: 14, color: '#4b5563', lineHeight: '20px', margin: '0 0 16px' }
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', margin: '0 0 16px', fontSize: 12 }
const th: React.CSSProperties = { textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: '6px 8px', color: '#111827' }
const td: React.CSSProperties = { borderBottom: '1px solid #f3f4f6', padding: '6px 8px', color: '#374151' }
const button: React.CSSProperties = { display: 'inline-block', backgroundColor: '#111827', color: '#ffffff', padding: '10px 14px', borderRadius: 8, textDecoration: 'none', fontSize: 14 }
const hint: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginTop: 16 }

export default ScheduledReportEmail
