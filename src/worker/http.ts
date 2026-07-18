import * as errore from "errore"
import type { z } from "@hono/zod-openapi"
import type { Context } from "hono"
import { ApiErrorSchema } from "@/shared/domain"
import type { Env } from "./env"
import { InvalidInputError, toErrorResponse } from "./errors"

export type AppContext = { Bindings: Env }

export const jsonContent = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
})

export const commonErrorResponses = {
  400: jsonContent(ApiErrorSchema, "Invalid request"),
  401: jsonContent(ApiErrorSchema, "Authentication required"),
  404: jsonContent(ApiErrorSchema, "Resource not found"),
  409: jsonContent(ApiErrorSchema, "Resource conflict"),
  429: jsonContent(ApiErrorSchema, "Request throttled"),
  500: jsonContent(ApiErrorSchema, "Storage or server failure"),
} as const

export function respondError(c: Context<AppContext>, error: Error) {
  const response = toErrorResponse(error)
  return c.json(response.body, response.status, response.headers)
}

export async function parseJsonInput<T>({
  read,
  schema,
}: {
  read: () => Promise<unknown>
  schema: z.ZodType<T>
}) {
  const input = await read().catch(
    (cause) => new InvalidInputError({ reason: "Request body is not valid JSON", cause }),
  )
  if (input instanceof Error) return input

  return errore.try({
    try: () => schema.parse(input),
    catch: (cause) => new InvalidInputError({ reason: "Request body is invalid", cause }),
  })
}
