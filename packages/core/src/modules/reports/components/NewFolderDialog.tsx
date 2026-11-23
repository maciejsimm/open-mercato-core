"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { RadioGroup } from '@open-mercato/ui/primitives/radio'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type NewFolderParent = {
  id: string
  name: string
  kind: 'private' | 'public'
}

export type NewFolderDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editable folder the new folder is created in; null creates a top-level folder. */
  parent: NewFolderParent | null
  onCreated: (folderId: string | null) => void
}

type FolderKind = 'private' | 'public'

/**
 * Create a report folder. Inside an editable folder the new folder inherits
 * its visibility; at the top level the user picks private ("My Reports") or
 * public (organization-wide — the server requires `reports.admin`).
 */
export function NewFolderDialog({ open, onOpenChange, parent, onCreated }: NewFolderDialogProps) {
  const t = useT()
  const [name, setName] = React.useState('')
  const [kind, setKind] = React.useState<FolderKind>('private')
  const [saving, setSaving] = React.useState(false)
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({ contextId: 'reports.folders.new' })

  React.useEffect(() => {
    if (!open) return
    setName('')
    setKind(parent?.kind ?? 'private')
  }, [open, parent])

  const trimmed = name.trim()
  const canSave = trimmed.length > 0 && !saving

  const save = React.useCallback(async () => {
    if (!canSave) return
    setSaving(true)
    const payload = {
      name: trimmed,
      kind: parent ? parent.kind : kind,
      parentFolderId: parent ? parent.id : null,
    }
    try {
      const response = await runMutation({
        operation: () =>
          apiCallOrThrow<{ id?: string }>('/api/reports/folders', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }),
        context: { formId: 'reports.folders.new', resourceKind: 'reports.folder' },
        mutationPayload: payload,
      })
      const createdId = typeof response.result?.id === 'string' ? response.result.id : null
      flash(t('reports.list.folders.create.success', 'Folder created.'), 'success')
      onOpenChange(false)
      onCreated(createdId)
    } catch (err) {
      const message = err instanceof Error && err.message
        ? err.message
        : t('reports.list.folders.create.error', 'Failed to create folder.')
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [canSave, kind, onCreated, onOpenChange, parent, runMutation, t, trimmed])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void save()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('reports.list.folders.create.title', 'New folder')}</DialogTitle>
          <DialogDescription>
            {parent
              ? t('reports.list.folders.create.inParent', 'Created inside "{folder}" with the same visibility.', { folder: parent.name })
              : t('reports.list.folders.create.description', 'Group reports and dashboards. Access is inherited from the folder.')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <FieldLabel htmlFor="reports-new-folder-name" required>
              {t('reports.list.folders.create.name', 'Name')}
            </FieldLabel>
            <Input
              id="reports-new-folder-name"
              value={name}
              autoFocus
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
                  event.preventDefault()
                  void save()
                }
              }}
            />
          </div>
          {parent ? null : (
            <RadioGroup value={kind} onValueChange={(value) => setKind(value === 'public' ? 'public' : 'private')} className="space-y-2">
              <RadioField
                value="private"
                label={t('reports.list.folders.create.private', 'Private')}
                description={t('reports.list.folders.create.privateHint', 'Only you (and people you share it with) can see it.')}
              />
              <RadioField
                value="public"
                label={t('reports.list.folders.create.public', 'Public')}
                description={t('reports.list.folders.create.publicHint', 'Visible to everyone with access to reports. Requires reports administrator rights.')}
              />
            </RadioGroup>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('reports.list.folders.create.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={!canSave}>
            {saving
              ? t('reports.list.folders.create.saving', 'Creating…')
              : t('reports.list.folders.create.submit', 'Create folder')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default NewFolderDialog
