import * as errore from "errore"
import { z } from "zod"
import { AssetEventSchema, type AssetEvent } from "@/shared/events"
import type { Env } from "./env"
import { InternalFailureError } from "./errors"

const MAX_FAILURES = 5
const BLOCK_SECONDS = 15 * 60

const AttemptInputSchema = z.object({ valid: z.boolean(), now: z.number().int().nonnegative() })
const AttemptStateSchema = z.object({
  failures: z.number().int().nonnegative(),
  blockedUntil: z.number().int().nonnegative(),
})

export const AttemptResultSchema = z.discriminatedUnion("tag", [
  z.object({ tag: z.literal("allowed") }),
  z.object({ tag: z.literal("rejected"), attemptsRemaining: z.number().int().nonnegative() }),
  z.object({ tag: z.literal("blocked"), retryAfterSeconds: z.number().int().positive() }),
])

export type AttemptResult = z.infer<typeof AttemptResultSchema>

type StreamController = ReadableStreamDefaultController<Uint8Array>

type EventStreamState =
  | { tag: "opening" }
  | { tag: "open"; controller: StreamController }
  | { tag: "closed" }

class EventStreamSource implements UnderlyingSource<Uint8Array> {
  private state: EventStreamState = { tag: "opening" }
  private readonly clients: Set<StreamController>

  constructor(clients: Set<StreamController>) {
    this.clients = clients
  }

  start(controller: StreamController) {
    this.state = { tag: "open", controller }
    this.clients.add(controller)
    controller.enqueue(new TextEncoder().encode(toServerSentEvent({ tag: "connected" })))
  }

  cancel() {
    if (this.state.tag === "open") this.clients.delete(this.state.controller)
    this.state = { tag: "closed" }
  }
}

export class AssetBoxCoordinator implements DurableObject {
  private readonly state: DurableObjectState
  private readonly clients = new Set<StreamController>()

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state
  }

  async fetch(request: Request) {
    const path = new URL(request.url).pathname
    if (path === "/auth-attempt" && request.method === "POST") return this.handleAttempt(request)
    if (path === "/events" && request.method === "GET") return this.openEventStream()
    if (path === "/broadcast" && request.method === "POST") return this.broadcast(request)
    return new Response("Not found", { status: 404 })
  }

  private async handleAttempt(request: Request) {
    const input = await request
      .json()
      .then((value) => AttemptInputSchema.safeParse(value))
      .catch((cause) => new InternalFailureError({ operation: "throttle request parsing", cause }))
    if (input instanceof Error) return Response.json({ error: input.message }, { status: 400 })
    if (!input.success) return Response.json({ error: "Invalid attempt payload" }, { status: 400 })

    const stored = await this.state.storage
      .get("attempt-state")
      .catch((cause) => new InternalFailureError({ operation: "throttle state read", cause }))
    if (stored instanceof Error) return Response.json({ error: stored.message }, { status: 500 })

    const attemptState = (() => {
      if (stored === undefined) return { failures: 0, blockedUntil: 0 }
      const parsed = AttemptStateSchema.safeParse(stored)
      if (!parsed.success) {
        return new InternalFailureError({ operation: "throttle state parsing" })
      }
      return parsed.data
    })()
    if (attemptState instanceof Error) {
      return Response.json({ error: attemptState.message }, { status: 500 })
    }

    const result = decideAttempt({ state: attemptState, input: input.data })

    const persisted = await persistAttemptState({
      storage: this.state.storage,
      result,
    })
    if (persisted instanceof Error)
      return Response.json({ error: persisted.message }, { status: 500 })

    return Response.json(result.response)
  }

  private openEventStream() {
    const stream = new ReadableStream<Uint8Array>(new EventStreamSource(this.clients))

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
      },
    })
  }

  private async broadcast(request: Request) {
    const event = await request
      .json()
      .then((value) => AssetEventSchema.safeParse(value))
      .catch((cause) => new InternalFailureError({ operation: "event parsing", cause }))
    if (event instanceof Error) return Response.json({ error: event.message }, { status: 400 })
    if (!event.success) return Response.json({ error: "Invalid event payload" }, { status: 400 })

    const encoded = new TextEncoder().encode(toServerSentEvent(event.data))
    for (const client of this.clients) {
      const sent = errore.try({
        try: () => client.enqueue(encoded),
        catch: (cause) => new InternalFailureError({ operation: "event delivery", cause }),
      })
      if (sent instanceof Error) {
        console.warn("Removing disconnected event client", sent)
        this.clients.delete(client)
      }
    }

    return new Response(null, { status: 204 })
  }
}

export function decideAttempt({
  state,
  input,
}: {
  state: z.infer<typeof AttemptStateSchema>
  input: z.infer<typeof AttemptInputSchema>
}) {
  if (state.blockedUntil > input.now) {
    const retryAfterSeconds = Math.max(1, Math.ceil((state.blockedUntil - input.now) / 1000))
    return {
      response: { tag: "blocked", retryAfterSeconds } as AttemptResult,
      nextState: state,
    }
  }

  if (input.valid) {
    return {
      response: { tag: "allowed" } as AttemptResult,
      nextState: { failures: 0, blockedUntil: 0 },
    }
  }

  const failures = state.failures + 1
  if (failures >= MAX_FAILURES) {
    return {
      response: { tag: "blocked", retryAfterSeconds: BLOCK_SECONDS } as AttemptResult,
      nextState: { failures: 0, blockedUntil: input.now + BLOCK_SECONDS * 1000 },
    }
  }

  return {
    response: { tag: "rejected", attemptsRemaining: MAX_FAILURES - failures } as AttemptResult,
    nextState: { failures, blockedUntil: 0 },
  }
}

async function persistAttemptState({
  storage,
  result,
}: {
  storage: DurableObjectStorage
  result: ReturnType<typeof decideAttempt>
}) {
  if (result.nextState.failures === 0 && result.nextState.blockedUntil === 0) {
    return storage
      .delete("attempt-state")
      .catch((cause) => new InternalFailureError({ operation: "throttle state reset", cause }))
  }

  return storage
    .put("attempt-state", result.nextState)
    .catch((cause) => new InternalFailureError({ operation: "throttle state write", cause }))
}

function toServerSentEvent(event: AssetEvent) {
  return `event: ${event.tag}\ndata: ${JSON.stringify(event)}\n\n`
}
