"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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

type DashboardRow = {
  id: string
  name: string
  description: string | null
  folderId: string
  ownerUserId: string
  visibility: 'private' | 'public'
  permission: 'view' | 'edit'
  layout: unknown
  parameters: unknown
  version: number
  lastExecutedAt: string | null
  updatedAt: string | null
}

type DashboardsResponse = {
  items?: DashboardRow[]
  total?: number
  page?: number
  totalPages?: number
}

function formatDate(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleString()
}

export default function DashboardsListPage() {
  const router = useRouter()
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [rows, setRows] = React.useState<DashboardRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(50)
  const [search, setSearch] = React.useState('')
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
        const trimmed = search.trim()
        if (trimmed) params.set('q', trimmed)
        const fallback: DashboardsResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<DashboardsResponse>(`/api/reports/dashboards?${params.toString()}`, undefined, { fallback })
        if (cancelled) return
        if (!call.ok) {
          flash(t('reports.dashboards.list.error.load', 'Failed to load dashboards.'), 'error')
          setRows([])
          setTotal(0)
          setTotalPages(1)
          return
        }
        const payload = call.result ?? fallback
        const items = Array.isArray(payload.items) ? payload.items : []
        setRows(items)
        setTotal(typeof payload.total === 'number' ? payload.total : items.length)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : t('reports.dashboards.list.error.load', 'Failed to load dashboards.')
        flash(message, 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, pageSize, reloadToken, scopeVersion, search, t])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleDelete = React.useCallback(
    async (dashboard: DashboardRow) => {
      const name = dashboard.name || t('reports.dashboards.list.deleteFallbackName', 'this dashboard')
      const confirmed = await confirm({
        title: t('reports.dashboards.list.deleteConfirm', 'Delete dashboard "{name}"?').replace('{name}', name),
        variant: 'destructive',
      })
      if (!confirmed) return
      try {
        await apiCallOrThrow(`/api/reports/dashboards?id=${encodeURIComponent(dashboard.id)}`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
        })
        setRows((prev) => prev.filter((row) => row.id !== dashboard.id))
        setTotal((prev) => Math.max(prev - 1, 0))
        flash(t('reports.dashboards.list.deleteSuccess', 'Dashboard deleted.'), 'success')
        handleRefresh()
      } catch (err) {
        const message = err instanceof Error ? err.message : t('reports.dashboards.list.deleteError', 'Failed to delete dashboard.')
        flash(message, 'error')
      }
    },
    [confirm, handleRefresh, t],
  )

  const columns = React.useMemo<ColumnDef<DashboardRow>[]>(() => {
    const noValue = <span className="text-sm text-muted-foreground">{t('reports.dashboards.list.noValue', '—')}</span>
    return [
      {
        accessorKey: 'name',
        header: t('reports.dashboards.list.columns.name', 'Name'),
        cell: ({ row }) => (
          <Link href={`/backend/reports/dashboards/${row.original.id}`} className="font-medium hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: 'description',
        header: t('reports.dashboards.list.columns.description', 'Description'),
        cell: ({ row }) =>
          row.original.description
            ? <span className="text-sm">{row.original.description}</span>
            : noValue,
      },
      {
        accessorKey: 'updatedAt',
        header: t('reports.dashboards.list.columns.updated', 'Updated'),
        cell: ({ row }) =>
          row.original.updatedAt
            ? <span className="text-sm">{formatDate(row.original.updatedAt, t('reports.dashboards.list.noValue', '—'))}</span>
            : noValue,
      },
    ]
  }, [t])

  const newDashboardButton = (
    <Button asChild>
      <Link href="/backend/reports/dashboards/new">
        <Plus className="size-4" aria-hidden />
        <span>{t('reports.dashboards.list.actions.new', 'New dashboard')}</span>
      </Link>
    </Button>
  )

  const emptyState = (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30 px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">
        {t('reports.dashboards.list.empty.title', 'No dashboards yet')}
      </p>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {t(
          'reports.dashboards.list.empty.description',
          'Dashboards compose multiple report tiles with shared parameters. Create your first dashboard to pin the reports your team cares about.',
        )}
      </p>
      <div className="mt-4">
        <Button asChild size="sm" variant="outline">
          <Link href="/backend/reports/dashboards/new">
            <Plus className="size-4" aria-hidden />
            <span>{t('reports.dashboards.list.actions.new', 'New dashboard')}</span>
          </Link>
        </Button>
      </div>
    </div>
  )

  return (
    <Page>
      <PageBody>
        <DataTable<DashboardRow>
          title={t('reports.dashboards.list.title', 'Dashboards')}
          refreshButton={{
            label: t('reports.dashboards.list.actions.refresh', 'Refresh'),
            onRefresh: () => { setSearch(''); setPage(1); handleRefresh() },
          }}
          actions={newDashboardButton}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('reports.dashboards.list.searchPlaceholder', 'Search dashboards…')}
          entityIds={['reports:dashboard']}
          onRowClick={(row) => router.push(`/backend/reports/dashboards/${row.id}`)}
          rowActions={(row) => {
            const items = [
              {
                id: 'open',
                label: t('reports.dashboards.list.actions.open', 'Open'),
                onSelect: () => router.push(`/backend/reports/dashboards/${row.id}`),
              },
              {
                id: 'open-new-tab',
                label: t('reports.dashboards.list.actions.openInNewTab', 'Open in new tab'),
                onSelect: () => window.open(`/backend/reports/dashboards/${row.id}`, '_blank', 'noopener'),
              },
            ]
            if (row.permission === 'edit') {
              items.push({
                id: 'delete',
                label: t('reports.dashboards.list.actions.delete', 'Delete'),
                destructive: true,
                onSelect: () => handleDelete(row),
              } as (typeof items)[number] & { destructive: boolean })
            }
            return <RowActions items={items} />
          }}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
          emptyState={emptyState}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
