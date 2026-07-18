import * as errore from "errore"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { ApiRequestError } from "@/client/lib/api"
import { AssetEventSchema } from "@/shared/events"
import { libraryQueryKey } from "../api/library.queries"
import { workRequestQueryKey } from "../api/work-request.queries"
import {
  clearDeletedAssetSelection,
  markLiveConnected,
  markLiveDisconnected,
  showNewAsset,
} from "../state/library.actions"

export function useLiveUpdates() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const events = new EventSource("/api/events")

    const onConnected = () => markLiveConnected()
    const onLibraryEvent = (event: MessageEvent<string>) => {
      const payload = errore.try({
        try: () => JSON.parse(event.data) as unknown,
        catch: (cause) => new ApiRequestError({ message: "Live update was not valid JSON", cause }),
      })
      if (payload instanceof Error) {
        console.warn(payload.message)
        return
      }

      const parsed = AssetEventSchema.safeParse(payload)
      if (!parsed.success || parsed.data.tag === "connected") {
        console.warn("Ignored an invalid live update")
        return
      }
      if (parsed.data.tag === "asset-created") showNewAsset(parsed.data.asset)
      if (parsed.data.tag === "work-result-created") showNewAsset(parsed.data.asset)
      if (parsed.data.tag === "asset-deleted") {
        clearDeletedAssetSelection(parsed.data.assetId)
      }
      void queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      void queryClient.invalidateQueries({ queryKey: workRequestQueryKey })
    }
    const onError = () => markLiveDisconnected()

    events.addEventListener("connected", onConnected)
    events.addEventListener("asset-created", onLibraryEvent)
    events.addEventListener("asset-updated", onLibraryEvent)
    events.addEventListener("asset-deleted", onLibraryEvent)
    events.addEventListener("tags-changed", onLibraryEvent)
    events.addEventListener("work-request-changed", onLibraryEvent)
    events.addEventListener("work-result-created", onLibraryEvent)
    events.addEventListener("error", onError)

    return () => events.close()
  }, [queryClient])
}
