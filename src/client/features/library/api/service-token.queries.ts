import { queryOptions } from "@tanstack/react-query"
import { api, expectApiValue } from "@/client/lib/api"

export const serviceTokenQueryKey = ["asset-box", "service-tokens"] as const

export function serviceTokenQueryOptions() {
  return queryOptions({
    queryKey: serviceTokenQueryKey,
    queryFn: async () => expectApiValue(await api.serviceTokens()),
  })
}
