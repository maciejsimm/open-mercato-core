"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Plus } from 'lucide-react'

type ScheduleRow = {
  id: string
  reportId: string
  name: string
  cadence: string
  timezone: string
  recipients: Array<{ type: 'user' | 'role' | 'email'; userId?: string; roleId?: string; email?: string }>
  params: Record<string, unknown>
  formats: string[]
  enabled: boolean
  lastRunAt: string | null
  nextRunAt: string | null
  failureCount: number
}

type SchedulesResponse = { items?: ScheduleRow[]; total?: number; page?: number; totalPages?: number }

function formatDate(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleString()
}

function summarizeRecipients(recipients: ScheduleRow['recipients'], t: ReturnType<typeof useT>): string {
  if (!recipients.length) return t('reports.schedules.list.noRecipients', 'No recipients')
  const counts = { user: 0, role: 0, email: 0 }
  for (const r of recipients) counts[r.type] += 1
  const parts: string[] = []
  if (counts.email) parts.push(t('reports.schedules.list.countEmail', '{count} email').replace('{count}', String(counts.email)))
  if (counts.user) parts.push(t('reports.schedules.list.countUser', '{count} user').replace('{count}', String(counts.user)))
  if (counts.role) parts.push(t('reports.schedules.list.countRole', '{count} role').replace('{count}', String(counts.role)))
  return parts.join(' · ')
}

export default function SchedulesListPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [rows, setRows] = React.useState<ScheduleRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(50)
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', String(pageSize))
        const fallback: SchedulesResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<SchedulesResponse>(`/api/reports/schedules?${params.toString()}`, undefined, { fallback })
        if (cancelled) return
        if (!call.ok) {
          flash(t('reports.schedules.list.error.load', 'Failed to load schedules.'), 'error')
          setRows([]); setTotal(0); setTotalPages(1)
          return
        }
        const payload = call.result ?? fallback
        const items = Array.isArray(payload.items) ? payload.items : []
        setRows(items)
        setTotal(typeof payload.total === 'number' ? payload.total : items.length)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : t('reports.schedules.list.error.load', 'Failed to load schedules.')
        flash(message, 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, pageSize, reloadToken, scopeVersion, t])

  const handleRefresh = React.useCallback(() => setReloadToken((v) => v + 1), [])

  const handleToggleEnabled = React.useCallback(async (schedule: ScheduleRow) => {
    try {
      await apiCallOrThrow('/api/reports/schedules', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: schedule.id, enabled: !schedule.enabled }),
      })
      flash(
        schedule.enabled
          ? t('reports.schedules.list.disableSuccess', 'Schedule disabled.')
          : t('reports.schedules.list.enableSuccess', 'Schedule enabled.'),
        'success',
      )
      handleRefresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('reports.schedules.list.toggleError', 'Failed to toggle schedule.')
      flash(message, 'error')
    }
  }, [handleRefresh, t])

  const handleDelete = React.useCallback(async (schedule: ScheduleRow) => {
    const confirmed = await confirm({
      title: t('reports.schedules.list.deleteConfirm', 'Delete schedule "{name}"?').replace('{name}', schedule.name),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await apiCallOrThrow(`/api/reports/schedules?id=${encodeURIComponent(schedule.id)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
      })
      setRows((prev) => prev.filter((row) => row.id !== schedule.id))
      setTotal((prev) => Math.max(prev - 1, 0))
      flash(t('reports.schedules.list.deleteSuccess', 'Schedule deleted.'), 'success')
      handleRefresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('reports.schedules.list.deleteError', 'Failed to delete schedule.')
      flash(message, 'error')
    }
  }, [confirm, handleRefresh, t])

  const columns = React.useMemo<ColumnDef<ScheduleRow>[]>(() => {
    const noValue = <span className="text-sm text-muted-foreground">{t('reports.schedules.list.noValue', '—')}</span>
    return [
      {
        accessorKey: 'name',
        header: t('reports.schedules.list.columns.name', 'Name'),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: 'cadence',
        header: t('reports.schedules.list.columns.cadence', 'Cadence'),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-mono text-xs">{row.original.cadence}</span>
            <span className="text-xs text-muted-foreground">{row.original.timezone}</span>
          </div>
        ),
      },
      {
        accessorKey: 'recipients',
        header: t('reports.schedules.list.columns.recipients', 'Recipients'),
        cell: ({ row }) => <span className="text-sm">{summarizeRecipients(row.original.recipients, t)}</span>,
      },
      {
        accessorKey: 'formats',
        header: t('reports.schedules.list.columns.formats', 'Formats'),
        cell: ({ row }) => <span className="font-mono text-xs uppercase">{row.original.formats.join(', ')}</span>,
      },
      {
        accessorKey: 'nextRunAt',
        header: t('reports.schedules.list.columns.nextRun', 'Next run'),
        cell: ({ row }) => row.original.nextRunAt
          ? <span className="text-sm">{formatDate(row.original.nextRunAt, t('reports.schedules.list.noValue', '—'))}</span>
          : noValue,
      },
      {
        accessorKey: 'enabled',
        header: t('reports.schedules.list.columns.enabled', 'Enabled'),
        cell: ({ row }) => (
          <span className={row.original.enabled ? 'text-status-success-text' : 'text-muted-foreground'}>
            {row.original.enabled ? t('reports.schedules.list.enabledYes', 'On') : t('reports.schedules.list.enabledNo', 'Off')}
          </span>
        ),
      },
    ]
  }, [t])

  const newScheduleButton = (
    <Button asChild>
      <Link href="/backend/reports/schedules/new">
        <Plus className="size-4" aria-hidden />
        <span>{t('reports.schedules.list.actions.new', 'New schedule')}</span>
      </Link>
    </Button>
  )

  const emptyState = (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30 px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">
        {t('reports.schedules.list.empty.title', 'No schedules yet')}
      </p>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {t(
          'reports.schedules.list.empty.description',
          'Schedule a report to email it on a cadence (weekly, monthly, or custom cron).',
        )}
      </p>
      <div className="mt-4">
        <Button asChild size="sm" variant="outline">
          <Link href="/backend/reports/schedules/new">
            <Plus className="size-4" aria-hidden />
            <span>{t('reports.schedules.list.actions.new', 'New schedule')}</span>
          </Link>
        </Button>
      </div>
    </div>
  )

  return (
    <Page>
      <PageBody>
        <DataTable<ScheduleRow>
          title={t('reports.schedules.list.title', 'Schedules')}
          refreshButton={{
            label: t('reports.schedules.list.actions.refresh', 'Refresh'),
            onRefresh: handleRefresh,
          }}
          actions={newScheduleButton}
          columns={columns}
          data={rows}
          entityIds={['reports:schedule']}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'toggle',
                  label: row.enabled
                    ? t('reports.schedules.list.actions.disable', 'Disable')
                    : t('reports.schedules.list.actions.enable', 'Enable'),
                  onSelect: () => handleToggleEnabled(row),
                },
                {
                  id: 'delete',
                  label: t('reports.schedules.list.actions.delete', 'Delete'),
                  destructive: true,
                  onSelect: () => handleDelete(row),
                },
              ]}
            />
          )}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
          emptyState={emptyState}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
