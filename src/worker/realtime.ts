import type { Context } from "hono"
import type { AssetEvent } from "@/shared/events"
import { InternalFailureError } from "./errors"
import type { AppContext } from "./http"

export async function broadcastEvent({
  env,
  event,
}: {
  env: AppContext["Bindings"]
  event: AssetEvent
}) {
  const coordinator = env.COORDINATOR.get(env.COORDINATOR.idFromName("events"))
  const notified = await coordinator
    .fetch("https://coordinator/broadcast", {
      method: "POST",
      body: JSON.stringify(event),
    })
    .catch((cause) => new InternalFailureError({ operation: "live update broadcast", cause }))
  if (notified instanceof Error) {
    console.warn("Committed change, but live update failed", notified)
    return
  }
  if (!notified.ok) console.warn("Committed change, but live update returned", notified.status)
}

export function notifyClients({ c, event }: { c: Context<AppContext>; event: AssetEvent }) {
  return broadcastEvent({ env: c.env, event })
}
