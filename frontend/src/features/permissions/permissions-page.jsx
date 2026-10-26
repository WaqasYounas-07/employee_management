import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Info, Lock, RotateCcw, Save, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/features/auth/auth-context'
import { cn } from '@/lib/utils'

/**
 * The role x permission matrix.
 *
 * Edits are held locally until saved, so a mistake can be undone without a
 * round trip, and the whole batch is applied in one transaction.
 */
export function PermissionsPage() {
  const queryClient = useQueryClient()
  const { can, refresh } = useAuth()
  const editable = can('manage_permissions')

  /* Pending edits, keyed `role:permission` -> boolean, tagged with the
     matrix they were made against. A refetch that returns a new matrix
     therefore discards stale edits without needing an effect. */
  const [edits, setEdits] = useState({ base: null, values: {} })

  const { data, isLoading } = useQuery({
    queryKey: ['permissions'],
    queryFn: async () => (await api.get('/permissions/')).data,
  })

  const granted = useMemo(() => {
    const map = {}
    for (const [role, perms] of Object.entries(data?.matrix ?? {})) {
      for (const perm of perms) map[`${role}:${perm}`] = true
    }
    return map
  }, [data])

  const draft = edits.base === data ? edits.values : {}
  const setDraft = (updater) =>
    setEdits((prev) => {
      const current = prev.base === data ? prev.values : {}
      return {
        base: data,
        values: typeof updater === 'function' ? updater(current) : updater,
      }
    })

  const valueOf = (role, perm) => {
    const key = `${role}:${perm}`
    return key in draft ? draft[key] : Boolean(granted[key])
  }

  const toggle = (role, perm) => {
    const key = `${role}:${perm}`
    const next = !valueOf(role, perm)
    setDraft((d) => {
      const copy = { ...d }
      // Returning a cell to its saved value is not a change.
      if (next === Boolean(granted[key])) delete copy[key]
      else copy[key] = next
      return copy
    })
  }

  const changes = Object.entries(draft).map(([key, value]) => {
    const [role, permission] = key.split(':')
    return { role, permission, granted: value }
  })

  const save = useMutation({
    mutationFn: async () => (await api.post('/permissions/', { changes })).data,
    onSuccess: async (result) => {
      toast.success(result.detail ?? 'Permissions updated.')
      setDraft({})
      queryClient.invalidateQueries({ queryKey: ['permissions'] })
      // The signed-in user's own menu may have just changed.
      await refresh()
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not save permissions.')),
  })

  const roles = data?.roles ?? []
  const groups = data?.groups ?? []

  if (isLoading) {
    return (
      <>
        <PageHeader title="Permissions" />
        <Skeleton className="h-96 w-full" />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Permissions"
        description="What each role can see and do. Changes apply to everyone with that role."
      >
        {editable && (
          <>
            <Button
              variant="outline"
              onClick={() => setDraft({})}
              disabled={!changes.length || save.isPending}
            >
              <RotateCcw /> Discard
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={!changes.length}
              loading={save.isPending}
            >
              <Save /> Save{changes.length ? ` (${changes.length})` : ''}
            </Button>
          </>
        )}
      </PageHeader>

      {!editable && (
        <div className="flex items-start gap-2.5 rounded-lg border border-info/30 bg-info/10 p-4 text-sm text-info">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            You can see this matrix but not change it. Ask an admin if a role
            needs different access.
          </p>
        </div>
      )}

      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          The API checks these permissions on every request, so unticking a box
          genuinely blocks the action — it does not merely hide a link. The{' '}
          <span className="font-medium text-foreground">Admin</span> role always
          holds everything, so there is no way to lock every admin out of this page.
        </p>
      </div>

      {groups.map((group) => (
        <Card key={group.key}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{group.label}</CardTitle>
            <CardDescription>{group.description}</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="min-w-[260px] px-6 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Permission
                    </th>
                    {roles.map((role) => (
                      <th key={role.value} className="w-28 px-4 py-2.5 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {role.label}
                          </span>
                          {!role.editable && (
                            <Badge tone="muted" className="gap-1 px-1.5 py-0 text-[10px]">
                              <Lock className="h-2.5 w-2.5" /> fixed
                            </Badge>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.permissions.map((perm) => (
                    <tr
                      key={perm.value}
                      className="border-b border-border last:border-b-0 hover:bg-muted/40"
                    >
                      <td className="px-6 py-3">
                        <p className="font-medium">{perm.label}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {perm.value}
                        </p>
                      </td>
                      {roles.map((role) => {
                        const checked = valueOf(role.value, perm.value)
                        const dirty = `${role.value}:${perm.value}` in draft
                        return (
                          <td key={role.value} className="px-4 py-3 text-center">
                            <div
                              className={cn(
                                'inline-flex rounded-md p-1 transition-colors',
                                dirty && 'bg-warning/15 ring-1 ring-warning/40',
                              )}
                            >
                              <Checkbox
                                checked={checked}
                                disabled={!role.editable || !editable}
                                onCheckedChange={() => toggle(role.value, perm.value)}
                                aria-label={`${perm.label} for ${role.label}`}
                              />
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* A sticky bar so the save action stays reachable on a long matrix. */}
      {editable && changes.length > 0 && (
        <div className="sticky bottom-4 z-20 flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-3 shadow-lg">
          <p className="text-sm">
            <span className="font-semibold tabular-nums">{changes.length}</span>{' '}
            unsaved change{changes.length === 1 ? '' : 's'}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setDraft({})}>
              Discard
            </Button>
            <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>
              <Save /> Save
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
