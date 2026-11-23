"use client"

import * as React from 'react'
import { Trash2, User, Users } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type PrincipalType = 'user' | 'role'
type Permission = 'view' | 'edit'

type ShareRow = {
  id: string
  principalType: PrincipalType
  principalId: string
  permission: Permission
}

type PrincipalsResponse = {
  users?: Array<{ id: string; label: string; email: string | null }>
  roles?: Array<{ id: string; name: string }>
}

type SharesResponse = { items?: ShareRow[] }

export type ShareFolderDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  folder: { id: string; name: string } | null
  onChanged?: () => void
}

/**
 * Manage who a private report folder is shared with. Reports and dashboards
 * in the folder inherit the grant: `view` lets principals open and run them,
 * `edit` also lets them change them and add content.
 */
export function ShareFolderDialog({ open, onOpenChange, folder, onChanged }: ShareFolderDialogProps) {
  const t = useT()
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({ contextId: 'reports.folders.share' })
  const [shares, setShares] = React.useState<ShareRow[]>([])
  const [principals, setPrincipals] = React.useState<Required<PrincipalsResponse>>({ users: [], roles: [] })
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [principalType, setPrincipalType] = React.useState<PrincipalType>('user')
  const [principalId, setPrincipalId] = React.useState('')
  const [permission, setPermission] = React.useState<Permission>('view')
  const [reloadToken, setReloadToken] = React.useState(0)

  React.useEffect(() => {
    if (!open || !folder) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      apiCall<SharesResponse>(`/api/reports/folder-shares?folderId=${encodeURIComponent(folder.id)}&pageSize=100`, undefined, { fallback: { items: [] } }),
      apiCall<PrincipalsResponse>('/api/reports/share-principals', undefined, { fallback: { users: [], roles: [] } }),
    ])
      .then(([sharesCall, principalsCall]) => {
        if (cancelled) return
        if (!sharesCall.ok) flash(t('reports.list.folders.share.loadError', 'Failed to load folder sharing.'), 'error')
        setShares(Array.isArray(sharesCall.result?.items) ? sharesCall.result.items : [])
        setPrincipals({
          users: Array.isArray(principalsCall.result?.users) ? principalsCall.result.users : [],
          roles: Array.isArray(principalsCall.result?.roles) ? principalsCall.result.roles : [],
        })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [folder, open, reloadToken, t])

  React.useEffect(() => {
    if (!open) return
    setPrincipalId('')
    setPermission('view')
  }, [open, principalType])

  const labelOf = React.useCallback(
    (share: ShareRow): string => {
      if (share.principalType === 'role') {
        return principals.roles.find((role) => role.id === share.principalId)?.name
          ?? t('reports.list.folders.share.unknownRole', 'Unknown role')
      }
      return principals.users.find((user) => user.id === share.principalId)?.label
        ?? t('reports.list.folders.share.unknownUser', 'Unknown user')
    },
    [principals, t],
  )

  const sharedKeys = React.useMemo(
    () => new Set(shares.map((share) => `${share.principalType}:${share.principalId}`)),
    [shares],
  )
  const options = principalType === 'user'
    ? principals.users.map((user) => ({ id: user.id, label: user.email && user.email !== user.label ? `${user.label} (${user.email})` : user.label }))
    : principals.roles.map((role) => ({ id: role.id, label: role.name }))
  const availableOptions = options.filter((option) => !sharedKeys.has(`${principalType}:${option.id}`))

  const addShare = React.useCallback(async () => {
    if (!folder || !principalId || saving) return
    setSaving(true)
    const payload = { folderId: folder.id, principalType, principalId, permission }
    try {
      await runMutation({
        operation: () => apiCallOrThrow('/api/reports/folder-shares', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        context: { formId: 'reports.folders.share', resourceKind: 'reports.folder_share', resourceId: folder.id },
        mutationPayload: payload,
      })
      flash(t('reports.list.folders.share.added', 'Folder shared.'), 'success')
      setPrincipalId('')
      setReloadToken((token) => token + 1)
      onChanged?.()
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : t('reports.list.folders.share.addError', 'Failed to share folder.')
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [folder, onChanged, permission, principalId, principalType, runMutation, saving, t])

  const removeShare = React.useCallback(async (share: ShareRow) => {
    if (!folder) return
    try {
      await runMutation({
        operation: () => apiCallOrThrow(`/api/reports/folder-shares?id=${encodeURIComponent(share.id)}`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
        }),
        context: { formId: 'reports.folders.share', resourceKind: 'reports.folder_share', resourceId: share.id },
        mutationPayload: { id: share.id },
      })
      flash(t('reports.list.folders.share.removed', 'Access removed.'), 'success')
      setReloadToken((token) => token + 1)
      onChanged?.()
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : t('reports.list.folders.share.removeError', 'Failed to remove access.')
      flash(message, 'error')
    }
  }, [folder, onChanged, runMutation, t])

  const permissionLabel = (value: Permission) => value === 'edit'
    ? t('reports.list.folders.share.permissionEdit', 'Can edit')
    : t('reports.list.folders.share.permissionView', 'Can view')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void addShare()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t('reports.list.folders.share.title', 'Share "{folder}"', { folder: folder?.name ?? '' })}
          </DialogTitle>
          <DialogDescription>
            {t('reports.list.folders.share.description', 'Reports and dashboards in this folder are shared too. Viewers also need access to the underlying data.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <FieldLabel>{t('reports.list.folders.share.add', 'Add people or roles')}</FieldLabel>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select value={principalType} onValueChange={(value) => setPrincipalType(value === 'role' ? 'role' : 'user')}>
                <SelectTrigger className="sm:w-28" aria-label={t('reports.list.folders.share.principalType', 'Share with')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">{t('reports.list.folders.share.typeUser', 'User')}</SelectItem>
                  <SelectItem value="role">{t('reports.list.folders.share.typeRole', 'Role')}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={principalId || undefined} onValueChange={setPrincipalId}>
                <SelectTrigger className="min-w-0 flex-1" aria-label={t('reports.list.folders.share.principal', 'Who')}>
                  <SelectValue
                    placeholder={principalType === 'user'
                      ? t('reports.list.folders.share.pickUser', 'Choose a user…')
                      : t('reports.list.folders.share.pickRole', 'Choose a role…')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableOptions.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      {t('reports.list.folders.share.noOptions', 'Nothing left to share with.')}
                    </div>
                  ) : (
                    availableOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Select value={permission} onValueChange={(value) => setPermission(value === 'edit' ? 'edit' : 'view')}>
                <SelectTrigger className="sm:w-32" aria-label={t('reports.list.folders.share.permission', 'Permission')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="view">{permissionLabel('view')}</SelectItem>
                  <SelectItem value="edit">{permissionLabel('edit')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <FieldLabel>{t('reports.list.folders.share.current', 'Who has access')}</FieldLabel>
            {loading ? (
              <p className="text-sm text-muted-foreground">{t('reports.list.folders.share.loading', 'Loading…')}</p>
            ) : shares.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('reports.list.folders.share.empty', 'Only you can see this folder.')}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {shares.map((share) => (
                  <li key={share.id} className="flex items-center gap-2 px-3 py-2">
                    {share.principalType === 'role'
                      ? <Users className="size-4 text-muted-foreground" aria-hidden />
                      : <User className="size-4 text-muted-foreground" aria-hidden />}
                    <span className="min-w-0 flex-1 truncate text-sm">{labelOf(share)}</span>
                    <span className="text-xs text-muted-foreground">{permissionLabel(share.permission)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => void removeShare(share)}
                      aria-label={t('reports.list.folders.share.remove', 'Remove access')}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('reports.list.folders.share.close', 'Close')}
          </Button>
          <Button type="button" onClick={() => void addShare()} disabled={!principalId || saving}>
            {saving
              ? t('reports.list.folders.share.sharing', 'Sharing…')
              : t('reports.list.folders.share.submit', 'Share')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
