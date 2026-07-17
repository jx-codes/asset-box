import * as errore from "errore"
import type { z } from "zod"
import {
  ApiErrorSchema,
  LibrarySchema,
  SessionSchema,
  TagInputSchema,
  TagSchema,
  type TagInput,
} from "@/shared/domain"

export class ApiRequestError extends errore.createTaggedError({
  name: "ApiRequestError",
  message: "$message",
}) {}

async function requestJson<T>({
  path,
  schema,
  method = "GET",
  body,
}: {
  path: string
  schema: z.ZodType<T>
  method?: "GET" | "POST" | "PUT"
  body?: unknown
}) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((cause) => new ApiRequestError({ message: "Could not reach Asset Box", cause }))
  if (response instanceof Error) return response

  const payload = await response
    .json()
    .catch((cause) => new ApiRequestError({ message: "Asset Box returned invalid JSON", cause }))
  if (payload instanceof Error) return payload

  if (!response.ok) {
    const apiError = ApiErrorSchema.safeParse(payload)
    if (apiError.success) return new ApiRequestError({ message: apiError.data.error.message })
    return new ApiRequestError({ message: `Asset Box returned HTTP ${response.status}` })
  }

  return errore.try({
    try: () => schema.parse(payload),
    catch: (cause) => new ApiRequestError({ message: "Asset Box returned unexpected data", cause }),
  })
}

async function requestEmpty({ path, method }: { path: string; method: "DELETE" }) {
  const response = await fetch(path, { method, credentials: "same-origin" }).catch(
    (cause) => new ApiRequestError({ message: "Could not reach Asset Box", cause }),
  )
  if (response instanceof Error) return response
  if (response.ok) return { tag: "completed" as const }

  const payload = await response
    .json()
    .catch((cause) => new ApiRequestError({ message: "Asset Box returned invalid JSON", cause }))
  if (payload instanceof Error) return payload
  const apiError = ApiErrorSchema.safeParse(payload)
  if (apiError.success) return new ApiRequestError({ message: apiError.data.error.message })
  return new ApiRequestError({ message: `Asset Box returned HTTP ${response.status}` })
}

export function expectApiValue<T>(value: Error | T): T {
  if (value instanceof Error) throw new Error(value.message, { cause: value })
  return value
}

export const api = {
  session: () => requestJson({ path: "/api/session", schema: SessionSchema }),
  login: (password: string) =>
    requestJson({ path: "/api/login", method: "POST", body: { password }, schema: SessionSchema }),
  logout: () => requestJson({ path: "/api/logout", method: "POST", schema: SessionSchema }),
  library: () => requestJson({ path: "/api/library", schema: LibrarySchema }),
  createTag: (input: TagInput) =>
    requestJson({
      path: "/api/tags",
      method: "POST",
      body: TagInputSchema.parse(input),
      schema: TagSchema,
    }),
  updateTag: ({ id, input }: { id: string; input: TagInput }) =>
    requestJson({
      path: `/api/tags/${id}`,
      method: "PUT",
      body: TagInputSchema.parse(input),
      schema: TagSchema,
    }),
  deleteTag: (id: string) => requestEmpty({ path: `/api/tags/${id}`, method: "DELETE" }),
}
