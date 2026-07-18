import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, CircleDashed, Clock3, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { WorkRequest } from "@/shared/work-requests"
import { newAssetWorkRequestsQueryOptions } from "../api/work-request.queries"

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value))
}

function RequestLifecycleBadge({ request }: { request: WorkRequest }) {
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
    case "completed":
      return (
        <Badge variant="secondary">
          <CheckCircle2 /> Done
        </Badge>
      )
  }
}

function RequestLifecycleDetail({ request }: { request: WorkRequest }) {
  const lifecycle = request.lifecycle
  switch (lifecycle.tag) {
    case "draft":
      return "Add and submit instructions before this request can start."
    case "submitted":
      return "Waiting for a worker to claim it."
    case "claimed":
      return `Worker lease ends ${formatDateTime(lifecycle.expiresAt)}.`
    case "completed":
      return `Completed ${formatDateTime(lifecycle.completedAt)}.`
  }
}

export function RequestStatusList() {
  const requests = useQuery(newAssetWorkRequestsQueryOptions())

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
          New asset requests will appear here as soon as they are submitted.
        </p>
      </div>
    )
  }

  return (
    <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" aria-label="Asset requests">
      {requests.data.requests.map((request) => {
        const target = request.target
        const title = target.tag === "new-asset" ? target.title : target.asset.title
        const blurb = target.tag === "new-asset" ? target.blurb : target.asset.blurb

        return (
          <li key={request.id} className="border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-semibold">{title}</p>
              <RequestLifecycleBadge request={request} />
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{blurb}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              <RequestLifecycleDetail request={request} />
            </p>
            <time
              className="mt-1 block text-[11px] text-muted-foreground"
              dateTime={request.createdAt}
            >
              Requested {formatDateTime(request.createdAt)}
            </time>
          </li>
        )
      })}
    </ol>
  )
}
