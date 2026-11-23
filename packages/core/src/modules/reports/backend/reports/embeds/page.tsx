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

type EmbedRow = {
  id: string
  hostSpotId: string
  hostEntityId: string
  artifactType: 'report' | 'dashboard'
  artifactId: string
  paramBindings: Record<string, unknown>
  displayTitle: string | null
  position: number
  enabled: boolean
  createdAt: string | null
  updatedAt: string | null
}

type EmbedsResponse = {
  items?: EmbedRow[]
  total?: number
  page?: number
  totalPages?: number
}

export default function EmbedsListPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [rows, setRows] = React.useState<EmbedRow[]>([])
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
        const fallback: EmbedsResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<EmbedsResponse>(`/api/reports/embeds?${params.toString()}`, undefined, { fallback })
        if (cancelled) return
        if (!call.ok) {
          flash(t('reports.embeds.list.error.load', 'Failed to load embeds.'), 'error')
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
        const message = err instanceof Error ? err.message : t('reports.embeds.list.error.load', 'Failed to load embeds.')
        flash(message, 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, pageSize, reloadToken, scopeVersion, t])

  const handleRefresh = React.useCallback(() => setReloadToken((v) => v + 1), [])

  const handleToggleEnabled = React.useCallback(
    async (embed: EmbedRow) => {
      try {
        await apiCallOrThrow('/api/reports/embeds', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: embed.id, enabled: !embed.enabled }),
        })
        flash(
          embed.enabled
            ? t('reports.embeds.list.disableSuccess', 'Embed disabled.')
            : t('reports.embeds.list.enableSuccess', 'Embed enabled.'),
          'success',
        )
        handleRefresh()
      } catch (err) {
        const message = err instanceof Error ? err.message : t('reports.embeds.list.toggleError', 'Failed to toggle embed.')
        flash(message, 'error')
      }
    },
    [handleRefresh, t],
  )

  const handleDelete = React.useCallback(
    async (embed: EmbedRow) => {
      const confirmed = await confirm({
        title: t('reports.embeds.list.deleteConfirm', 'Delete this embed?'),
        variant: 'destructive',
      })
      if (!confirmed) return
      try {
        await apiCallOrThrow(`/api/reports/embeds?id=${encodeURIComponent(embed.id)}`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
        })
        setRows((prev) => prev.filter((row) => row.id !== embed.id))
        setTotal((prev) => Math.max(prev - 1, 0))
        flash(t('reports.embeds.list.deleteSuccess', 'Embed deleted.'), 'success')
        handleRefresh()
      } catch (err) {
        const message = err instanceof Error ? err.message : t('reports.embeds.list.deleteError', 'Failed to delete embed.')
        flash(message, 'error')
      }
    },
    [confirm, handleRefresh, t],
  )

  const columns = React.useMemo<ColumnDef<EmbedRow>[]>(() => {
    return [
      {
        accessorKey: 'displayTitle',
        header: t('reports.embeds.list.columns.title', 'Title'),
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.displayTitle ?? t('reports.embeds.list.untitled', '— untitled —')}
          </span>
        ),
      },
      {
        accessorKey: 'hostSpotId',
        header: t('reports.embeds.list.columns.host', 'Host'),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-mono text-xs">{row.original.hostSpotId}</span>
            <span className="font-mono text-xs text-muted-foreground">{row.original.hostEntityId}</span>
          </div>
        ),
      },
      {
        accessorKey: 'artifactType',
        header: t('reports.embeds.list.columns.artifact', 'Artifact'),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-xs uppercase text-muted-foreground">{row.original.artifactType}</span>
            <span className="font-mono text-xs">{row.original.artifactId.slice(0, 8)}…</span>
          </div>
        ),
      },
      {
        accessorKey: 'enabled',
        header: t('reports.embeds.list.columns.enabled', 'Enabled'),
        cell: ({ row }) => (
          <span className={row.original.enabled ? 'text-status-success-text' : 'text-muted-foreground'}>
            {row.original.enabled ? t('reports.embeds.list.enabledYes', 'On') : t('reports.embeds.list.enabledNo', 'Off')}
          </span>
        ),
      },
    ]
  }, [t])

  const newEmbedButton = (
    <Button asChild>
      <Link href="/backend/reports/embeds/new">
        <Plus className="size-4" aria-hidden />
        <span>{t('reports.embeds.list.actions.new', 'New embed')}</span>
      </Link>
    </Button>
  )

  const emptyState = (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30 px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">
        {t('reports.embeds.list.empty.title', 'No embeds yet')}
      </p>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {t(
          'reports.embeds.list.empty.description',
          'Embeds attach a report or dashboard to a record page widget spot. Add one to render the artifact with parameters bound to the host record.',
        )}
      </p>
      <div className="mt-4">
        <Button asChild size="sm" variant="outline">
          <Link href="/backend/reports/embeds/new">
            <Plus className="size-4" aria-hidden />
            <span>{t('reports.embeds.list.actions.new', 'New embed')}</span>
          </Link>
        </Button>
      </div>
    </div>
  )

  return (
    <Page>
      <PageBody>
        <DataTable<EmbedRow>
          title={t('reports.embeds.list.title', 'Record-page embeds')}
          refreshButton={{
            label: t('reports.embeds.list.actions.refresh', 'Refresh'),
            onRefresh: handleRefresh,
          }}
          actions={newEmbedButton}
          columns={columns}
          data={rows}
          entityIds={['reports:embed']}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'toggle',
                  label: row.enabled
                    ? t('reports.embeds.list.actions.disable', 'Disable')
                    : t('reports.embeds.list.actions.enable', 'Enable'),
                  onSelect: () => handleToggleEnabled(row),
                },
                {
                  id: 'delete',
                  label: t('reports.embeds.list.actions.delete', 'Delete'),
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
