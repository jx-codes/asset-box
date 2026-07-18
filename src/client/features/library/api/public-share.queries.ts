import { queryOptions } from "@tanstack/react-query"
import { api, expectApiValue } from "@/client/lib/api"

export const publicShareQueryKey = ["asset-box", "public-shares"] as const

export function publicShareQueryOptions(assetId: string) {
  return queryOptions({
    queryKey: [...publicShareQueryKey, assetId],
    queryFn: async () => expectApiValue(await api.publicShares(assetId)),
  })
}
