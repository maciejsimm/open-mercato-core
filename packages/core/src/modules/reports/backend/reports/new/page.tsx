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

const reportNewSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional().or(z.literal('')),
  datasetId: z.string().trim().min(1),
  folderId: z.string().uuid({ message: 'Pick a folder' }),
})

type ReportNewValues = z.infer<typeof reportNewSchema>

type FolderOption = {
  id: string
  name: string
  kind: 'private' | 'public'
  ownedByViewer: boolean
}

type DatasetOption = {
  id: string
  moduleId: string
  labelKey: string
}

function folderGroupLabel(folder: FolderOption, t: ReturnType<typeof useT>): string {
  if (folder.kind === 'public') return t('reports.list.folders.publicRoot', 'Public')
  if (folder.ownedByViewer) return t('reports.list.folders.privateRoot', 'My Reports')
  return t('reports.list.folders.sharedRoot', 'Shared with me')
}

export default function ReportsNewPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useT()
  const initialFolderId = searchParams?.get('folderId') ?? ''

  const loadDatasetOptions = React.useCallback(async () => {
    const call = await apiCall<{ items?: DatasetOption[] }>(
      '/api/reports/datasets',
      undefined,
      { fallback: { items: [] } },
    )
    if (!call.ok) return []
    const items = Array.isArray(call.result?.items) ? call.result!.items! : []
    return items.map((dataset) => ({
      value: dataset.id,
      label: `${dataset.id} — ${t(dataset.labelKey, dataset.id)}`,
    }))
  }, [t])

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
      label: t('reports.new.fields.name', 'Name'),
      type: 'text',
      required: true,
    },
    {
      id: 'description',
      label: t('reports.new.fields.description', 'Description'),
      type: 'textarea',
    },
    {
      id: 'datasetId',
      label: t('reports.new.fields.dataset', 'Dataset'),
      type: 'select',
      required: true,
      loadOptions: loadDatasetOptions,
      description: t('reports.new.fields.datasetHint', 'Pick the dataset this report queries. Datasets are declared by modules.'),
    },
    {
      id: 'folderId',
      label: t('reports.new.fields.folder', 'Folder'),
      type: 'select',
      required: true,
      loadOptions: loadFolderOptions,
    },
  ]

  const handleSubmit = React.useCallback(async (values: ReportNewValues) => {
    try {
      const payload = {
        name: values.name,
        description: values.description?.trim() ? values.description.trim() : null,
        folderId: values.folderId,
        datasetId: values.datasetId,
        type: 'flat_list' as const,
        definition: {
          type: 'flat_list' as const,
          fields: ['id'],
          filters: [],
          sort: [],
        },
        parameters: [],
      }
      const response = await readApiResultOrThrow<{ id: string }>(
        '/api/reports/reports',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!response?.id) {
        throw createCrudFormError(t('reports.new.error.create', 'Failed to create report.'))
      }
      flash(t('reports.new.success', 'Report created.'), 'success')
      router.push(`/backend/reports/reports/${response.id}`)
    } catch (err) {
      if (err && typeof err === 'object' && 'message' in err) throw err
      throw createCrudFormError(t('reports.new.error.create', 'Failed to create report.'))
    }
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <CrudForm<ReportNewValues>
          title={t('reports.new.pageTitle', 'New Report')}
          schema={reportNewSchema}
          fields={fields}
          initialValues={initialFolderId ? { folderId: initialFolderId } as Partial<ReportNewValues> : undefined}
          submitLabel={t('reports.new.actions.create', 'Create report')}
          cancelHref="/backend/reports"
          backHref="/backend/reports"
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
