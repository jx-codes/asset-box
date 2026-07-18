import { queryOptions } from "@tanstack/react-query"
import { api, expectApiValue } from "@/client/lib/api"

export const workRequestQueryKey = ["asset-box", "work-requests"] as const

export function assetWorkRequestsQueryOptions(assetId: string) {
  return queryOptions({
    queryKey: [...workRequestQueryKey, "asset", assetId],
    queryFn: async () =>
      expectApiValue(await api.workRequests({ tag: "asset-edit", parentAssetId: assetId })),
    staleTime: 10_000,
  })
}

export function newAssetWorkRequestsQueryOptions() {
  return queryOptions({
    queryKey: [...workRequestQueryKey, "new-asset"],
    queryFn: async () => expectApiValue(await api.workRequests({ tag: "new-asset" })),
    staleTime: 10_000,
  })
}
