"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { z } from 'zod'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'

const dashboardNewSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional().or(z.literal('')),
  folderId: z.string().uuid({ message: 'Pick a folder' }),
})

type DashboardNewValues = z.infer<typeof dashboardNewSchema>

type FolderOption = {
  id: string
  name: string
  kind: 'private' | 'public'
  ownedByViewer: boolean
}

function folderGroupLabel(folder: FolderOption, t: ReturnType<typeof useT>): string {
  if (folder.kind === 'public') return t('reports.list.folders.publicRoot', 'Public')
  if (folder.ownedByViewer) return t('reports.list.folders.privateRoot', 'My Reports')
  return t('reports.list.folders.sharedRoot', 'Shared with me')
}

export default function DashboardsNewPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useT()
  const initialFolderId = searchParams?.get('folderId') ?? ''

  const loadFolderOptions = React.useCallback(async () => {
    const call = await apiCall<{ items?: FolderOption[] }>(
      '/api/reports/folders?pageSize=100',
      undefined,
      { fallback: { items: [] } },
    )
    if (!call.ok) return []
    const items = Array.isArray(call.result?.items) ? call.result!.items! : []
    return items.map((folder) => ({
      value: folder.id,
      label: `${folderGroupLabel(folder, t)} / ${folder.name}`,
    }))
  }, [t])

  const fields: CrudField[] = [
    {
      id: 'name',
      label: t('reports.dashboards.new.fields.name', 'Name'),
      type: 'text',
      required: true,
    },
    {
      id: 'description',
      label: t('reports.dashboards.new.fields.description', 'Description'),
      type: 'textarea',
    },
    {
      id: 'folderId',
      label: t('reports.dashboards.new.fields.folder', 'Folder'),
      type: 'select',
      required: true,
      loadOptions: loadFolderOptions,
    },
  ]

  const handleSubmit = React.useCallback(async (values: DashboardNewValues) => {
    try {
      const payload = {
        name: values.name,
        description: values.description?.trim() ? values.description.trim() : null,
        folderId: values.folderId,
        layout: {
          grid: { cols: 12, rowHeight: 80, gap: 8 },
          tiles: [],
        },
        parameters: [],
      }
      const response = await readApiResultOrThrow<{ id: string }>(
        '/api/reports/dashboards',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!response?.id) {
        throw createCrudFormError(t('reports.dashboards.new.error.create', 'Failed to create dashboard.'))
      }
      flash(t('reports.dashboards.new.success', 'Dashboard created.'), 'success')
      router.push(`/backend/reports/dashboards/${response.id}`)
    } catch (err) {
      if (err && typeof err === 'object' && 'message' in err) throw err
      throw createCrudFormError(t('reports.dashboards.new.error.create', 'Failed to create dashboard.'))
    }
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <CrudForm<DashboardNewValues>
          title={t('reports.dashboards.new.pageTitle', 'New Dashboard')}
          schema={dashboardNewSchema}
          fields={fields}
          initialValues={initialFolderId ? { folderId: initialFolderId } as Partial<DashboardNewValues> : undefined}
          submitLabel={t('reports.dashboards.new.actions.create', 'Create dashboard')}
          cancelHref="/backend/reports/dashboards"
          backHref="/backend/reports/dashboards"
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
