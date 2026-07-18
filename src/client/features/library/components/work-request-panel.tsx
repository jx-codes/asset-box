import { useValue } from "@legendapp/state/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Clock3, Send, SendHorizontal, X } from "lucide-react"
import { api, expectApiValue } from "@/client/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { WorkComment, WorkRequest } from "@/shared/work-requests"
import {
  assetWorkRequestsQueryOptions,
  newAssetWorkRequestsQueryOptions,
  workRequestQueryKey,
} from "../api/work-request.queries"
import {
  changeNewAssetBlurb,
  changeNewAssetTitle,
  changeWorkRequestDraft,
  clearWorkRequestDraft,
  closeWorkRequestPanel,
  showLatestNewAssetRequest,
} from "../state/work-request.actions"
import { workRequestPanel$ } from "../state/work-request.store"
import { RequestStatusList } from "./request-status-list"

export function WorkRequestPanel() {
  const state = useValue(workRequestPanel$.state)
  if (state.tag === "closed") return null

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-30 bg-black/25 lg:hidden"
        aria-label="Close work requests"
        onClick={closeWorkRequestPanel}
      />
      <aside className="fixed inset-x-0 bottom-0 z-40 flex max-h-[72dvh] min-h-0 flex-col border-t bg-background shadow-xl lg:static lg:z-auto lg:h-full lg:max-h-none lg:w-80 lg:flex-none lg:border-l lg:border-t-0 lg:shadow-none">
        <header className="flex h-12 flex-none items-center gap-2 border-b px-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">
              {state.tag === "asset"
                ? "Asset work request"
                : state.tag === "new-asset"
                  ? "Request a new asset"
                  : "Requests"}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {state.tag === "requests"
                ? "Queued, working, and completed requests."
                : "Drafts stay private until submitted."}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={closeWorkRequestPanel}
            aria-label="Close work requests"
          >
            <X />
          </Button>
        </header>
        {state.tag === "asset" ? (
          <AssetRequestContent assetId={state.assetId} draftBody={state.draftBody} />
        ) : state.tag === "new-asset" ? (
          <NewAssetRequestContent state={state} />
        ) : (
          <RequestStatusList />
        )}
      </aside>
    </>
  )
}

function AssetRequestContent({ assetId, draftBody }: { assetId: string; draftBody: string }) {
  const requests = useQuery(assetWorkRequestsQueryOptions(assetId))
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: async () =>
      expectApiValue(await api.createWorkRequest({ tag: "asset-edit", parentAssetId: assetId })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workRequestQueryKey })
    },
  })

  if (requests.isPending) return <PanelMessage>Loading work requests…</PanelMessage>
  if (requests.isError) {
    return <PanelError message={requests.error.message} retry={() => requests.refetch()} />
  }

  const request = requests.data.requests[0]
  if (!request) {
    return (
      <div className="p-4">
        <p className="text-sm font-medium">No work is queued</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Start a durable request, then add one or more freeform comments.
        </p>
        <Button className="mt-4 w-full" onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? "Starting…" : "Start request"}
        </Button>
        {create.isError ? <MutationError message={create.error.message} /> : null}
      </div>
    )
  }

  return <RequestThread request={request} draftBody={draftBody} />
}

function NewAssetRequestContent({
  state,
}: {
  state: Extract<ReturnType<typeof workRequestPanel$.state.peek>, { tag: "new-asset" }>
}) {
  const requests = useQuery(newAssetWorkRequestsQueryOptions())
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: async () =>
      expectApiValue(
        await api.createWorkRequest({ tag: "new-asset", title: state.title, blurb: state.blurb }),
      ),
    onSuccess: async () => {
      showLatestNewAssetRequest()
      await queryClient.invalidateQueries({ queryKey: workRequestQueryKey })
    },
  })

  if (requests.isPending) return <PanelMessage>Loading work requests…</PanelMessage>
  if (requests.isError) {
    return <PanelError message={requests.error.message} retry={() => requests.refetch()} />
  }

  const request = requests.data.requests[0]
  if (state.mode === "latest" && request) {
    return <RequestThread request={request} draftBody={state.draftBody} />
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="new-request-title">Asset title</Label>
          <Input
            id="new-request-title"
            value={state.title}
            maxLength={120}
            onChange={(event) => changeNewAssetTitle(event.currentTarget.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-request-blurb">Short description</Label>
          <Textarea
            id="new-request-blurb"
            value={state.blurb}
            maxLength={280}
            rows={3}
            onChange={(event) => changeNewAssetBlurb(event.currentTarget.value)}
          />
        </div>
        <Button
          className="w-full"
          onClick={() => create.mutate()}
          disabled={create.isPending || state.title.trim() === "" || state.blurb.trim() === ""}
        >
          {create.isPending ? "Creating…" : "Create request"}
        </Button>
        {create.isError ? <MutationError message={create.error.message} /> : null}
      </div>
    </div>
  )
}

function RequestThread({ request, draftBody }: { request: WorkRequest; draftBody: string }) {
  const queryClient = useQueryClient()
  const refresh = async () => {
    clearWorkRequestDraft()
    await queryClient.invalidateQueries({ queryKey: workRequestQueryKey })
  }
  const addDraft = useMutation({
    mutationFn: async () =>
      expectApiValue(
        await api.addDraftComment({ requestId: request.id, input: { body: draftBody } }),
      ),
    onSuccess: refresh,
  })
  const submitOne = useMutation({
    mutationFn: async (commentId: string) =>
      expectApiValue(await api.submitComment({ requestId: request.id, commentId })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workRequestQueryKey })
    },
  })
  const submitAll = useMutation({
    mutationFn: async () => expectApiValue(await api.submitAllComments(request.id)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workRequestQueryKey })
    },
  })
  const draftCount = request.comments.filter((comment) => comment.lifecycle.tag === "draft").length
  const error = addDraft.error ?? submitOne.error ?? submitAll.error

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <RequestStatus request={request} />
        <ol className="mt-3 space-y-2" aria-label="Request comments">
          {request.comments.length === 0 ? (
            <li className="border border-dashed p-4 text-center text-xs text-muted-foreground">
              Queue the first comment below.
            </li>
          ) : (
            request.comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                submitting={submitOne.isPending}
                submit={() => submitOne.mutate(comment.id)}
              />
            ))
          )}
        </ol>
      </div>
      <div className="flex-none border-t p-3">
        <Label htmlFor="request-comment" className="sr-only">
          Freeform work comment
        </Label>
        <Textarea
          id="request-comment"
          rows={3}
          maxLength={4000}
          placeholder="Describe the change or asset you need…"
          value={draftBody}
          onChange={(event) => changeWorkRequestDraft(event.currentTarget.value)}
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={() => addDraft.mutate()}
            disabled={addDraft.isPending || draftBody.trim() === ""}
          >
            <SendHorizontal /> Queue draft
          </Button>
          <Button
            onClick={() => submitAll.mutate()}
            disabled={submitAll.isPending || draftCount === 0}
          >
            <Send /> Submit all ({draftCount})
          </Button>
        </div>
        {error ? <MutationError message={error.message} /> : null}
      </div>
    </div>
  )
}

function RequestStatus({ request }: { request: WorkRequest }) {
  const label = (() => {
    if (request.lifecycle.tag === "draft") return "Draft comments only"
    if (request.lifecycle.tag === "submitted") return "Submitted for agent pickup"
    if (request.lifecycle.tag === "claimed") return "Claimed by an agent"
    return "Latest submitted work completed"
  })()
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Clock3 className="size-3.5" /> {label}
    </p>
  )
}

function CommentItem({
  comment,
  submitting,
  submit,
}: {
  comment: WorkComment
  submitting: boolean
  submit: () => void
}) {
  return (
    <li className="border bg-card p-3">
      <p className="whitespace-pre-wrap text-sm leading-5">{comment.body}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {comment.lifecycle.tag === "draft" ? null : <Check className="size-3" />}
          {comment.lifecycle.tag === "draft"
            ? "Private draft"
            : comment.lifecycle.tag === "submitted"
              ? "Submitted"
              : "Resolved"}
        </span>
        {comment.lifecycle.tag === "draft" ? (
          <Button size="xs" variant="outline" onClick={submit} disabled={submitting}>
            Submit
          </Button>
        ) : null}
      </div>
    </li>
  )
}

function PanelMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-40 flex-1 place-items-center p-4 text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function PanelError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="p-4">
      <MutationError message={message} />
      <Button className="mt-3" variant="outline" onClick={retry}>
        Try again
      </Button>
    </div>
  )
}

function MutationError({ message }: { message: string }) {
  return (
    <p className="mt-2 text-xs text-destructive" role="alert">
      {message}
    </p>
  )
}
