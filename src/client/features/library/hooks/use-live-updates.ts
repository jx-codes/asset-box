import * as errore from "errore"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { ApiRequestError } from "@/client/lib/api"
import { AssetEventSchema } from "@/shared/events"
import { libraryQueryKey } from "../api/library.queries"
import { markLiveConnected, markLiveDisconnected, showNewAsset } from "../state/library.actions"

export function useLiveUpdates() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const events = new EventSource("/api/events")

    const onConnected = () => markLiveConnected()
    const onAssetCreated = (event: MessageEvent<string>) => {
      const payload = errore.try({
        try: () => JSON.parse(event.data) as unknown,
        catch: (cause) => new ApiRequestError({ message: "Live update was not valid JSON", cause }),
      })
      if (payload instanceof Error) {
        console.warn(payload.message)
        return
      }

      const parsed = AssetEventSchema.safeParse(payload)
      if (!parsed.success || parsed.data.tag !== "asset-created") {
        console.warn("Ignored an invalid live update")
        return
      }
      showNewAsset(parsed.data.asset)
      void queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    }
    const onError = () => markLiveDisconnected()

    events.addEventListener("connected", onConnected)
    events.addEventListener("asset-created", onAssetCreated)
    events.addEventListener("error", onError)

    return () => events.close()
  }, [queryClient])
}
