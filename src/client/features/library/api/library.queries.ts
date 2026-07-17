import { queryOptions } from "@tanstack/react-query"
import { api, expectApiValue } from "@/client/lib/api"

export const libraryQueryKey = ["asset-box", "library"] as const

export const libraryQueryOptions = queryOptions({
  queryKey: libraryQueryKey,
  queryFn: async () => expectApiValue(await api.library()),
  staleTime: 30_000,
})
