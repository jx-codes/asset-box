import * as errore from "errore"
import { useObservable, useValue } from "@legendapp/state/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy, ExternalLink, Link2Off } from "lucide-react"
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
import type { Asset } from "@/shared/domain"
import {
  type PublicShare,
  type PublicShareCreateInput,
  PublicShareCreateInputSchema,
} from "@/shared/public-shares"
import { publicShareQueryKey, publicShareQueryOptions } from "../api/public-share.queries"
import { closeAssetDialog } from "../state/library.actions"

class PublicShareFormError extends errore.createTaggedError({
  name: "PublicShareFormError",
  message: "$message",
}) {}

const RawPublicShareFormSchema = z.object({ name: z.string(), expiresAt: z.string() })

type CopyState =
  | { tag: "idle" }
  | { tag: "copying" }
  | { tag: "copied" }
  | { tag: "failed"; message: string }

export function parsePublicShareForm(
  form: FormData,
): PublicShareFormError | PublicShareCreateInput {
  const raw = RawPublicShareFormSchema.safeParse(Object.fromEntries(form))
  if (!raw.success) return new PublicShareFormError({ message: "Complete the share form" })

  const expiresAt = (() => {
    if (raw.data.expiresAt === "") return { tag: "never" as const }
    const date = new Date(raw.data.expiresAt)
    if (Number.isNaN(date.getTime())) {
      return new PublicShareFormError({ message: "Expiration is invalid" })
    }
    return { tag: "scheduled" as const, value: date.toISOString() }
  })()
  if (expiresAt instanceof Error) return expiresAt

  const parsed = PublicShareCreateInputSchema.safeParse({
    name: raw.data.name,
    ...(expiresAt.tag === "scheduled" ? { expiresAt: expiresAt.value } : {}),
  })
  if (!parsed.success) {
    return new PublicShareFormError({
      message: parsed.error.issues[0]?.message ?? "Share input is invalid",
    })
  }
  return parsed.data
}

export function PublicShareDialog({ asset }: { asset: Asset }) {
  const queryClient = useQueryClient()
  const shares = useQuery(publicShareQueryOptions(asset.id))
  const copyState$ = useObservable({ state: { tag: "idle" } as CopyState })
  const copyState = useValue(copyState$.state)
  const createMutation = useMutation({
    mutationFn: async (form: FormData) => {
      const input = parsePublicShareForm(form)
      if (input instanceof Error) throw new Error(input.message, { cause: input })
      return expectApiValue(await api.createPublicShare({ assetId: asset.id, input }))
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: publicShareQueryKey })
    },
  })
  const revokeMutation = useMutation({
    mutationFn: async (shareId: string) =>
      expectApiValue(await api.revokePublicShare({ assetId: asset.id, shareId })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: publicShareQueryKey })
    },
  })

  const copyCreatedUrl = async () => {
    if (!createMutation.data) return
    copyState$.state.set({ tag: "copying" })
    if (!navigator.clipboard) {
      copyState$.state.set({ tag: "failed", message: "Clipboard access is not available" })
      return
    }
    const copied = await navigator.clipboard
      .writeText(createMutation.data.url)
      .then(() => ({ tag: "copied" as const }))
      .catch((cause) => new PublicShareFormError({ message: "Could not copy the link", cause }))
    if (copied instanceof Error) {
      copyState$.state.set({ tag: "failed", message: copied.message })
      return
    }
    copyState$.state.set(copied)
  }

  if (createMutation.data) {
    return (
      <Dialog open onOpenChange={(open) => !open && closeAssetDialog()}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Public link created</DialogTitle>
            <DialogDescription>
              Anyone with this link can preview and download “{asset.title}”. Copy it now; Asset Box
              cannot show the secret again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="created-public-share">Public link</Label>
            <div className="flex gap-2">
              <Input
                id="created-public-share"
                className="font-mono text-xs"
                value={createMutation.data.url}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                type="button"
                variant="outline"
                onClick={copyCreatedUrl}
                disabled={copyState.tag === "copying"}
              >
                <Copy />
                {copyState.tag === "copied" ? "Copied" : "Copy"}
              </Button>
              <Button variant="outline" size="icon" asChild>
                <a
                  href={createMutation.data.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open public link"
                >
                  <ExternalLink />
                </a>
              </Button>
            </div>
            {copyState.tag === "failed" ? (
              <p className="text-sm text-destructive" role="alert">
                {copyState.message}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                copyState$.state.set({ tag: "idle" })
                createMutation.reset()
              }}
            >
              Create another
            </Button>
            <Button onClick={closeAssetDialog}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && closeAssetDialog()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Public sharing</DialogTitle>
          <DialogDescription>
            Create a revocable link for “{asset.title}”. Leave expiration empty to keep it public
            until you take it offline.
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
            <Label htmlFor="public-share-name">Label</Label>
            <Input
              id="public-share-name"
              name="name"
              required
              maxLength={80}
              placeholder="Client review"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="public-share-expiration">Expiration (optional)</Label>
            <Input id="public-share-expiration" name="expiresAt" type="datetime-local" />
          </div>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create link"}
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
          {shares.isPending ? (
            <p className="text-sm text-muted-foreground">Loading links…</p>
          ) : null}
          {shares.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {shares.error.message}
            </p>
          ) : null}
          {shares.data?.publicShares.length === 0 ? (
            <p className="text-sm text-muted-foreground">No public links yet.</p>
          ) : null}
          {shares.data?.publicShares.map((share) => (
            <PublicShareRow
              key={share.id}
              publicShare={share}
              revoking={revokeMutation.isPending && revokeMutation.variables === share.id}
              onRevoke={(id) => revokeMutation.mutate(id)}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PublicShareRow({
  publicShare,
  revoking,
  onRevoke,
}: {
  publicShare: PublicShare
  revoking: boolean
  onRevoke: (id: string) => void
}) {
  const expiration = (() => {
    if (publicShare.status.tag === "revoked") {
      return `Offline since ${formatTimestamp(publicShare.status.revokedAt)}`
    }
    if (publicShare.status.tag === "expired") {
      return `Expired ${formatTimestamp(publicShare.status.expiredAt)}`
    }
    if (publicShare.status.expiration.tag === "scheduled") {
      return `Expires ${formatTimestamp(publicShare.status.expiration.expiresAt)}`
    }
    return "Stays online until you take it offline"
  })()
  const views =
    publicShare.views.tag === "never-viewed"
      ? "No views"
      : `${publicShare.views.count} view${publicShare.views.count === 1 ? "" : "s"}, last ${formatTimestamp(publicShare.views.lastViewedAt)}`
  const downloads =
    publicShare.downloads.tag === "never-downloaded"
      ? "No downloads"
      : `${publicShare.downloads.count} download${publicShare.downloads.count === 1 ? "" : "s"}, last ${formatTimestamp(publicShare.downloads.lastDownloadedAt)}`

  return (
    <div className="flex items-start gap-3 border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{publicShare.name}</span>
          <Badge variant={publicShare.status.tag === "active" ? "secondary" : "outline"}>
            {publicShare.status.tag === "active" ? "online" : publicShare.status.tag}
          </Badge>
        </div>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{publicShare.prefix}…</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{expiration}</p>
        <p className="text-xs leading-5 text-muted-foreground">
          {views} · {downloads}
        </p>
      </div>
      {publicShare.status.tag === "active" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={revoking}
          onClick={() => onRevoke(publicShare.id)}
        >
          <Link2Off />
          {revoking ? "Taking offline…" : "Take offline"}
        </Button>
      ) : null}
    </div>
  )
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString()
}
