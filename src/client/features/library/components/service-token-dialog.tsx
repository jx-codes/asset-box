import * as errore from "errore"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { api, expectApiValue } from "@/client/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { type ServiceToken, type ServiceTokenInput, ServiceTokenInputSchema } from "@/shared/domain"
import { serviceTokenQueryKey, serviceTokenQueryOptions } from "../api/service-token.queries"
import { closeServiceTokenManager } from "../state/library.actions"

class ServiceTokenFormError extends errore.createTaggedError({
  name: "ServiceTokenFormError",
  message: "$message",
}) {}

const RawServiceTokenFormSchema = z.object({
  name: z.string(),
  expiresAt: z.string(),
})

function parseServiceTokenForm(form: FormData): ServiceTokenFormError | ServiceTokenInput {
  const raw = RawServiceTokenFormSchema.safeParse(Object.fromEntries(form))
  if (!raw.success) return new ServiceTokenFormError({ message: "Complete the token form" })

  const expiresAt = (() => {
    if (raw.data.expiresAt === "") return { tag: "never" as const }
    const date = new Date(raw.data.expiresAt)
    if (Number.isNaN(date.getTime()))
      return new ServiceTokenFormError({ message: "Expiration is invalid" })
    return { tag: "scheduled" as const, value: date.toISOString() }
  })()
  if (expiresAt instanceof Error) return expiresAt

  const parsed = ServiceTokenInputSchema.safeParse({
    name: raw.data.name,
    ...(expiresAt.tag === "scheduled" ? { expiresAt: expiresAt.value } : {}),
  })
  if (!parsed.success) {
    return new ServiceTokenFormError({
      message: parsed.error.issues[0]?.message ?? "Token input is invalid",
    })
  }
  return parsed.data
}

export function ServiceTokenDialog() {
  const queryClient = useQueryClient()
  const tokens = useQuery(serviceTokenQueryOptions())
  const createMutation = useMutation({
    mutationFn: async (form: FormData) => {
      const input = parseServiceTokenForm(form)
      if (input instanceof Error) throw new Error(input.message, { cause: input })
      return expectApiValue(await api.createServiceToken(input))
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: serviceTokenQueryKey })
    },
  })
  const revokeMutation = useMutation({
    mutationFn: async (id: string) => expectApiValue(await api.revokeServiceToken(id)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: serviceTokenQueryKey })
    },
  })

  if (createMutation.data) {
    return (
      <Dialog open onOpenChange={(open) => !open && closeServiceTokenManager()}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Service token created</DialogTitle>
            <DialogDescription>
              Copy this token now. Asset Box cannot show it again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="created-service-token">Token</Label>
            <Input
              id="created-service-token"
              className="font-mono"
              value={createMutation.data.token}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <p className="text-xs text-muted-foreground">
              Store it as <code>ASSET_BOX_SERVICE_TOKEN</code> and close this dialog when saved.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={closeServiceTokenManager}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && closeServiceTokenManager()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Service tokens</DialogTitle>
          <DialogDescription>
            Create revocable credentials for agents and the CLI without sharing your password.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-3 border-b pb-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault()
            createMutation.mutate(new FormData(event.currentTarget))
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="service-token-name">Name</Label>
            <Input
              id="service-token-name"
              name="name"
              required
              maxLength={80}
              placeholder="Local CLI"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="service-token-expiration">Expiration (optional)</Label>
            <Input id="service-token-expiration" name="expiresAt" type="datetime-local" />
          </div>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create token"}
          </Button>
        </form>

        {createMutation.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {createMutation.error.message}
          </p>
        ) : null}
        {revokeMutation.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {revokeMutation.error.message}
          </p>
        ) : null}

        <div className="max-h-80 space-y-2 overflow-y-auto">
          {tokens.isPending ? (
            <p className="text-sm text-muted-foreground">Loading tokens…</p>
          ) : null}
          {tokens.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {tokens.error.message}
            </p>
          ) : null}
          {tokens.data?.serviceTokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">No service tokens yet.</p>
          ) : null}
          {tokens.data?.serviceTokens.map((token) => (
            <ServiceTokenRow
              key={token.id}
              token={token}
              revoking={revokeMutation.isPending && revokeMutation.variables === token.id}
              onRevoke={(id) => revokeMutation.mutate(id)}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ServiceTokenRow({
  token,
  revoking,
  onRevoke,
}: {
  token: ServiceToken
  revoking: boolean
  onRevoke: (id: string) => void
}) {
  const lastUsed =
    token.usage.tag === "used" ? formatTimestamp(token.usage.lastUsedAt) : "Never used"
  const expiration = (() => {
    if (token.status.tag === "revoked") return `Revoked ${formatTimestamp(token.status.revokedAt)}`
    if (token.status.tag === "expired") return `Expired ${formatTimestamp(token.status.expiredAt)}`
    if (token.status.expiration.tag === "scheduled") {
      return `Expires ${formatTimestamp(token.status.expiration.expiresAt)}`
    }
    return "Never expires"
  })()

  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{token.name}</span>
          <Badge variant={token.status.tag === "active" ? "secondary" : "outline"}>
            {token.status.tag}
          </Badge>
        </div>
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{token.prefix}…</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Created {formatTimestamp(token.createdAt)} · {lastUsed} · {expiration}
        </p>
      </div>
      {token.status.tag === "revoked" ? null : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={revoking}
          onClick={() => onRevoke(token.id)}
        >
          {revoking ? "Revoking…" : "Revoke"}
        </Button>
      )}
    </div>
  )
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString()
}
