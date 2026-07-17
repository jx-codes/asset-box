import { queryOptions } from "@tanstack/react-query"
import { api, expectApiValue } from "@/client/lib/api"
import type { LibraryView } from "@/shared/domain"

export const libraryQueryKey = ["asset-box", "library"] as const

export function libraryQueryOptions(view: LibraryView) {
  return queryOptions({
    queryKey: [...libraryQueryKey, view],
    queryFn: async () => expectApiValue(await api.library(view)),
    staleTime: 30_000,
  })
}
