"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Folder, FolderLock, Share2, Plus, ChevronRight, ChevronDown } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'

type ReportType = 'flat_list' | 'grouped' | 'pivot' | 'chart' | 'summary'

type FolderRow = {
  id: string
  parentFolderId: string | null
  kind: 'private' | 'public'
  ownerUserId: string | null
  ownedByViewer: boolean
  name: string
  position: number
  permission: 'view' | 'edit'
}

type ReportRow = {
  id: string
  name: string
  description: string | null
  type: ReportType
  datasetId: string
  folderId: string
  ownerUserId: string
  visibility: 'private' | 'public'
  permission: 'view' | 'edit'
  lastExecutedAt: string | null
  updatedAt: string | null
}

type FolderGroupKey = 'mine' | 'public' | 'shared'

type FolderGroup = {
  key: FolderGroupKey
  labelKey: string
  fallback: string
  icon: React.ReactNode
  items: FolderRow[]
}

type FoldersResponse = { items?: FolderRow[] }
type ReportsResponse = {
  items?: ReportRow[]
  total?: number
  page?: number
  totalPages?: number
}

const REPORT_TYPES: ReportType[] = ['flat_list', 'grouped', 'pivot', 'chart', 'summary']

function formatDate(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleString()
}

function groupFolders(folders: FolderRow[]): FolderGroup[] {
  const mine: FolderRow[] = []
  const publicFolders: FolderRow[] = []
  const shared: FolderRow[] = []
  for (const folder of folders) {
    if (folder.kind === 'private') {
      if (folder.ownedByViewer) mine.push(folder)
      else shared.push(folder)
    } else {
      publicFolders.push(folder)
    }
  }
  return [
    {
      key: 'mine',
      labelKey: 'reports.list.folders.privateRoot',
      fallback: 'My Reports',
      icon: <FolderLock className="size-4" aria-hidden />,
      items: mine,
    },
    {
      key: 'public',
      labelKey: 'reports.list.folders.publicRoot',
      fallback: 'Public',
      icon: <Folder className="size-4" aria-hidden />,
      items: publicFolders,
    },
    {
      key: 'shared',
      labelKey: 'reports.list.folders.sharedRoot',
      fallback: 'Shared with me',
      icon: <Share2 className="size-4" aria-hidden />,
      items: shared,
    },
  ]
}

type FolderNavigatorProps = {
  groups: FolderGroup[]
  selectedFolderId: string | null
  onSelect: (folderId: string | null) => void
  isLoading: boolean
  t: ReturnType<typeof useT>
}

function FolderNavigator({ groups, selectedFolderId, onSelect, isLoading, t }: FolderNavigatorProps) {
  const [openGroups, setOpenGroups] = React.useState<Record<FolderGroupKey, boolean>>({
    mine: true,
    public: true,
    shared: true,
  })
  const toggleGroup = React.useCallback((key: FolderGroupKey) => {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  return (
    <aside className="w-full shrink-0 rounded-md border border-border bg-card p-3 lg:w-72">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-overline text-muted-foreground">{t('reports.list.folders.title', 'Folders')}</h2>
      </div>
      <Button
        type="button"
        variant={selectedFolderId === null ? 'secondary' : 'ghost'}
        size="sm"
        className="mb-3 w-full justify-start"
        onClick={() => onSelect(null)}
      >
        {t('reports.list.folders.allReports', 'All reports')}
      </Button>
      <nav aria-label={t('reports.list.folders.title', 'Folders')} className="flex flex-col gap-3">
        {isLoading ? (
          <p className="px-2 text-sm text-muted-foreground">{t('reports.list.folders.loading', 'Loading folders…')}</p>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="space-y-1">
              <Button
                type="button"
                variant="muted"
                size="sm"
                className="h-auto w-full justify-between px-2 py-1"
                onClick={() => toggleGroup(group.key)}
                aria-expanded={openGroups[group.key]}
              >
                <span className="inline-flex items-center gap-2">
                  {group.icon}
                  <span className="text-sm font-medium">{t(group.labelKey, group.fallback)}</span>
                  <span className="text-xs text-muted-foreground">({group.items.length})</span>
                </span>
                {openGroups[group.key] ? (
                  <ChevronDown className="size-4" aria-hidden />
                ) : (
                  <ChevronRight className="size-4" aria-hidden />
                )}
              </Button>
              {openGroups[group.key] ? (
                group.items.length ? (
                  <ul className="space-y-0.5">
                    {group.items.map((folder) => {
                      const isActive = folder.id === selectedFolderId
                      return (
                        <li key={folder.id}>
                          <Button
                            type="button"
                            variant={isActive ? 'secondary' : 'ghost'}
                            size="sm"
                            className={cn(
                              'h-auto w-full justify-start px-2 py-1 text-left',
                              isActive ? 'font-medium' : 'font-normal',
                            )}
                            onClick={() => onSelect(folder.id)}
                          >
                            <Folder className="size-4 text-muted-foreground" aria-hidden />
                            <span className="truncate">{folder.name}</span>
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="px-2 text-xs text-muted-foreground">{t('reports.list.folders.empty', 'No folders yet')}</p>
                )
              ) : null}
            </div>
          ))
        )}
      </nav>
    </aside>
  )
}

export default function ReportsListPage() {
  const router = useRouter()
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [folders, setFolders] = React.useState<FolderRow[]>([])
  const [foldersLoading, setFoldersLoading] = React.useState(true)
  const [selectedFolderId, setSelectedFolderId] = React.useState<string | null>(null)

  const [rows, setRows] = React.useState<ReportRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(50)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    async function loadFolders() {
      setFoldersLoading(true)
      try {
        const fallback: FoldersResponse = { items: [] }
        const call = await apiCall<FoldersResponse>('/api/reports/folders?pageSize=100', undefined, { fallback })
        if (cancelled) return
        if (!call.ok) {
          flash(t('reports.list.error.foldersLoad', 'Failed to load folders.'), 'error')
          setFolders([])
          return
        }
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        setFolders(items)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : t('reports.list.error.foldersLoad', 'Failed to load folders.')
        flash(message, 'error')
      } finally {
        if (!cancelled) setFoldersLoading(false)
      }
    }
    loadFolders()
    return () => { cancelled = true }
  }, [scopeVersion, reloadToken, t])

  const groups = React.useMemo(() => groupFolders(folders), [folders])

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (selectedFolderId) params.set('folderId', selectedFolderId)
    const trimmed = search.trim()
    if (trimmed) params.set('q', trimmed)
    const typeFilter = filterValues.type
    if (typeof typeFilter === 'string' && typeFilter.trim()) params.set('type', typeFilter)
    return params.toString()
  }, [filterValues, page, pageSize, search, selectedFolderId])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const fallback: ReportsResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<ReportsResponse>(`/api/reports/reports?${queryParams}`, undefined, { fallback })
        if (cancelled) return
        if (!call.ok) {
          flash(t('reports.list.error.load', 'Failed to load reports.'), 'error')
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
        const message = err instanceof Error ? err.message : t('reports.list.error.load', 'Failed to load reports.')
        flash(message, 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [queryParams, reloadToken, scopeVersion, t])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleDelete = React.useCallback(
    async (report: ReportRow) => {
      const name = report.name || t('reports.list.deleteFallbackName', 'this report')
      const confirmed = await confirm({
        title: t('reports.list.deleteConfirm', 'Delete report "{name}"?').replace('{name}', name),
        variant: 'destructive',
      })
      if (!confirmed) return
      try {
        await apiCallOrThrow(`/api/reports/reports?id=${encodeURIComponent(report.id)}`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
        })
        setRows((prev) => prev.filter((row) => row.id !== report.id))
        setTotal((prev) => Math.max(prev - 1, 0))
        flash(t('reports.list.deleteSuccess', 'Report deleted.'), 'success')
        handleRefresh()
      } catch (err) {
        const message = err instanceof Error ? err.message : t('reports.list.deleteError', 'Failed to delete report.')
        flash(message, 'error')
      }
    },
    [confirm, handleRefresh, t],
  )

  const typeLabel = React.useCallback(
    (type: ReportType): string => t(`reports.list.types.${type}`, type),
    [t],
  )

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'type',
        label: t('reports.list.filters.type', 'Type'),
        type: 'select',
        options: REPORT_TYPES.map((type) => ({ value: type, label: typeLabel(type) })),
      },
    ],
    [t, typeLabel],
  )

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    setFilterValues(values)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
  }, [])

  const columns = React.useMemo<ColumnDef<ReportRow>[]>(() => {
    const noValue = <span className="text-sm text-muted-foreground">{t('reports.list.noValue', '—')}</span>
    return [
      {
        accessorKey: 'name',
        header: t('reports.list.columns.name', 'Name'),
        cell: ({ row }) => (
          <Link
            href={`/backend/reports/${row.original.id}`}
            className="font-medium hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: 'type',
        header: t('reports.list.columns.type', 'Type'),
        cell: ({ row }) => <span className="text-sm">{typeLabel(row.original.type)}</span>,
      },
      {
        accessorKey: 'datasetId',
        header: t('reports.list.columns.dataset', 'Dataset'),
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.datasetId}</span>,
      },
      {
        accessorKey: 'updatedAt',
        header: t('reports.list.columns.updated', 'Updated'),
        cell: ({ row }) =>
          row.original.updatedAt
            ? <span className="text-sm">{formatDate(row.original.updatedAt, t('reports.list.noValue', '—'))}</span>
            : noValue,
      },
    ]
  }, [t, typeLabel])

  const newReportHref = selectedFolderId
    ? `/backend/reports/new?folderId=${encodeURIComponent(selectedFolderId)}`
    : '/backend/reports/new'

  const newReportButton = (
    <Button asChild>
      <Link href={newReportHref}>
        <Plus className="size-4" aria-hidden />
        <span>{t('reports.list.actions.new', 'New report')}</span>
      </Link>
    </Button>
  )

  const emptyState = (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30 px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">
        {t('reports.list.empty.title', 'No reports yet')}
      </p>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {t(
          'reports.list.empty.description',
          'Create your first report to start analyzing your data. Pick a dataset, choose fields, save it to a folder.',
        )}
      </p>
      <div className="mt-4">
        <Button asChild size="sm" variant="outline">
          <Link href={newReportHref}>
            <Plus className="size-4" aria-hidden />
            <span>{t('reports.list.actions.new', 'New report')}</span>
          </Link>
        </Button>
      </div>
    </div>
  )

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-4 lg:flex-row">
          <FolderNavigator
            groups={groups}
            selectedFolderId={selectedFolderId}
            onSelect={(id) => { setSelectedFolderId(id); setPage(1) }}
            isLoading={foldersLoading}
            t={t}
          />
          <div className="min-w-0 flex-1">
            <DataTable<ReportRow>
              title={t('reports.list.title', 'Reports')}
              refreshButton={{
                label: t('reports.list.actions.refresh', 'Refresh'),
                onRefresh: () => { setSearch(''); setPage(1); handleRefresh() },
              }}
              actions={newReportButton}
              columns={columns}
              data={rows}
              searchValue={search}
              onSearchChange={(value) => { setSearch(value); setPage(1) }}
              searchPlaceholder={t('reports.list.searchPlaceholder', 'Search reports…')}
              filters={filters}
              filterValues={filterValues}
              onFiltersApply={handleFiltersApply}
              onFiltersClear={handleFiltersClear}
              entityIds={['reports:report']}
              onRowClick={(row) => router.push(`/backend/reports/${row.id}`)}
              rowActions={(row) => {
                const items = [
                  {
                    id: 'open',
                    label: t('reports.list.actions.open', 'Open'),
                    onSelect: () => router.push(`/backend/reports/${row.id}`),
                  },
                  {
                    id: 'open-new-tab',
                    label: t('reports.list.actions.openInNewTab', 'Open in new tab'),
                    onSelect: () => window.open(`/backend/reports/${row.id}`, '_blank', 'noopener'),
                  },
                ]
                if (row.permission === 'edit') {
                  items.push({
                    id: 'delete',
                    label: t('reports.list.actions.delete', 'Delete'),
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
          </div>
        </div>
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
