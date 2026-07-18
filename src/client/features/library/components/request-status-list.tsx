import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, CircleDashed, Clock3, LoaderCircle, TriangleAlert } from "lucide-react"
import { api, expectApiValue } from "@/client/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { WorkRequestStatusSummary } from "@/shared/work-requests"
import { workRequestQueryKey, workRequestStatusQueryOptions } from "../api/work-request.queries"

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

type AssetEditRequestStatus = WorkRequestStatusSummary & {
  target: Extract<WorkRequestStatusSummary["target"], { tag: "asset-edit" }>
}

type AssetRequestGroup = {
  assetId: string
  title: string
  blurb: string
  requests: AssetEditRequestStatus[]
}

export function groupWorkRequestStatuses(requests: WorkRequestStatusSummary[]) {
  const newAssetRequests: WorkRequestStatusSummary[] = []
  const groupsByAssetId = new Map<string, AssetRequestGroup>()

  for (const request of requests) {
    if (request.target.tag === "new-asset") {
      newAssetRequests.push(request)
      continue
    }

    const existing = groupsByAssetId.get(request.target.parentAssetId)
    if (existing) {
      existing.requests.push(request as AssetEditRequestStatus)
      continue
    }
    groupsByAssetId.set(request.target.parentAssetId, {
      assetId: request.target.parentAssetId,
      title: request.target.title,
      blurb: request.target.blurb,
      requests: [request as AssetEditRequestStatus],
    })
  }

  return { newAssetRequests, assetGroups: Array.from(groupsByAssetId.values()) }
}

function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value))
}

function RequestLifecycleBadge({ request }: { request: WorkRequestStatusSummary }) {
  const lifecycle = request.lifecycle
  switch (lifecycle.tag) {
    case "draft":
      return (
        <Badge variant="secondary">
          <CircleDashed /> Needs details
        </Badge>
      )
    case "submitted":
      return (
        <Badge variant="outline">
          <Clock3 /> Queued
        </Badge>
      )
    case "claimed":
      return (
        <Badge>
          <LoaderCircle /> Working
        </Badge>
      )
    case "failed":
      return (
        <Badge variant="destructive">
          <TriangleAlert /> Failed
        </Badge>
      )
    case "completed":
      return (
        <Badge variant="secondary">
          <CheckCircle2 /> Done
        </Badge>
      )
  }
}

function RequestLifecycleDetail({ request }: { request: WorkRequestStatusSummary }) {
  const lifecycle = request.lifecycle
  switch (lifecycle.tag) {
    case "draft":
      return "Add and submit instructions before this request can start."
    case "submitted":
      return "Waiting for a worker to claim it."
    case "claimed":
      return `Worker lease ends ${formatDateTime(lifecycle.expiresAt)}.`
    case "failed":
      return `Failed ${formatDateTime(lifecycle.failedAt)}: ${lifecycle.reason}`
    case "completed":
      return `Completed ${formatDateTime(lifecycle.completedAt)}.`
  }
}

function RequestStatusItem({
  request,
  showTargetTitle,
}: {
  request: WorkRequestStatusSummary
  showTargetTitle: boolean
}) {
  const queryClient = useQueryClient()
  const resubmit = useMutation({
    mutationFn: async () => expectApiValue(await api.resubmitWorkRequest(request.requestId)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workRequestQueryKey })
    },
  })
  const instruction =
    request.latestCommentBody ??
    (request.target.tag === "new-asset" ? request.target.blurb : "No instructions added.")

  return (
    <li className="border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {showTargetTitle ? (
            <p className="truncate text-sm font-semibold">{request.target.title}</p>
          ) : null}
          <p
            className={`${showTargetTitle ? "mt-1 text-xs text-muted-foreground" : "text-sm"} line-clamp-3 leading-5`}
          >
            {instruction}
          </p>
        </div>
        <RequestLifecycleBadge request={request} />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        <RequestLifecycleDetail request={request} />
      </p>
      <time className="mt-1 block text-[11px] text-muted-foreground" dateTime={request.createdAt}>
        Requested {formatDateTime(request.createdAt)}
      </time>
      {request.lifecycle.tag === "failed" ? (
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            disabled={resubmit.isPending}
            onClick={() => resubmit.mutate()}
          >
            {resubmit.isPending ? "Resubmitting…" : "Resubmit"}
          </Button>
          {resubmit.isError ? (
            <span className="text-xs text-destructive" role="alert">
              {resubmit.error.message}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function RequestGroup({
  title,
  description,
  requests,
  showTargetTitles,
}: {
  title: string
  description: string
  requests: WorkRequestStatusSummary[]
  showTargetTitles: boolean
}) {
  return (
    <section>
      <header className="border-y bg-muted/40 px-3 py-2">
        <h3 className="truncate text-xs font-semibold">{title}</h3>
        <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{description}</p>
      </header>
      <ol className="space-y-2 p-3">
        {requests.map((request) => (
          <RequestStatusItem
            key={request.requestId}
            request={request}
            showTargetTitle={showTargetTitles}
          />
        ))}
      </ol>
    </section>
  )
}

export function RequestStatusList() {
  const requests = useQuery(workRequestStatusQueryOptions())

  if (requests.isPending) {
    return <p className="p-4 text-sm text-muted-foreground">Loading requests…</p>
  }
  if (requests.isError) {
    return (
      <div className="p-4">
        <p className="text-sm text-destructive" role="alert">
          {requests.error.message}
        </p>
        <Button className="mt-3" variant="outline" onClick={() => requests.refetch()}>
          Try again
        </Button>
      </div>
    )
  }
  if (requests.data.requests.length === 0) {
    return (
      <div className="p-4">
        <p className="text-sm font-medium">No requests yet</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Submitted work will appear here with its current status.
        </p>
      </div>
    )
  }

  const groups = groupWorkRequestStatuses(requests.data.requests)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {groups.newAssetRequests.length === 0 ? null : (
        <RequestGroup
          title="New assets"
          description="Requests to create an asset."
          requests={groups.newAssetRequests}
          showTargetTitles
        />
      )}
      {groups.assetGroups.map((group) => (
        <RequestGroup
          key={group.assetId}
          title={group.title}
          description={group.blurb}
          requests={group.requests}
          showTargetTitles={false}
        />
      ))}
    </div>
  )
}
