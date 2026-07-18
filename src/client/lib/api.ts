import * as errore from "errore"
import type { z } from "zod"
import {
  ApiErrorSchema,
  type AssetLifecycleInput,
  AssetLifecycleInputSchema,
  AssetSchema,
  type AssetTagInput,
  AssetTagInputSchema,
  LibrarySchema,
  type LibraryView,
  ServiceTokenCreatedSchema,
  type ServiceTokenInput,
  ServiceTokenInputSchema,
  ServiceTokenListSchema,
  ServiceTokenSchema,
  SessionSchema,
  TagInputSchema,
  TagSchema,
  type TagInput,
} from "@/shared/domain"
import {
  type WorkCommentInput,
  WorkCommentInputSchema,
  WorkCommentSchema,
  type WorkRequestCreateInput,
  WorkRequestCreateInputSchema,
  WorkRequestListSchema,
  WorkRequestSchema,
} from "@/shared/work-requests"

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
  method?: "GET" | "POST" | "PUT" | "DELETE"
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
  library: (view: LibraryView) =>
    requestJson({ path: `/api/library?view=${view}`, schema: LibrarySchema }),
  workRequests: (target: { tag: "asset-edit"; parentAssetId: string } | { tag: "new-asset" }) =>
    requestJson({
      path:
        target.tag === "asset-edit"
          ? `/api/work-requests?parentAssetId=${encodeURIComponent(target.parentAssetId)}`
          : "/api/work-requests?kind=new",
      schema: WorkRequestListSchema,
    }),
  createWorkRequest: (input: WorkRequestCreateInput) =>
    requestJson({
      path: "/api/work-requests",
      method: "POST",
      body: WorkRequestCreateInputSchema.parse(input),
      schema: WorkRequestSchema,
    }),
  addDraftComment: ({ requestId, input }: { requestId: string; input: WorkCommentInput }) =>
    requestJson({
      path: `/api/work-requests/${requestId}/comments`,
      method: "POST",
      body: WorkCommentInputSchema.parse(input),
      schema: WorkCommentSchema,
    }),
  submitComment: ({ requestId, commentId }: { requestId: string; commentId: string }) =>
    requestJson({
      path: `/api/work-requests/${requestId}/comments/${commentId}/submit`,
      method: "POST",
      schema: WorkCommentSchema,
    }),
  submitAllComments: (requestId: string) =>
    requestJson({
      path: `/api/work-requests/${requestId}/comments/submit-all`,
      method: "POST",
      schema: WorkRequestSchema,
    }),
  serviceTokens: () => requestJson({ path: "/api/service-tokens", schema: ServiceTokenListSchema }),
  createServiceToken: (input: ServiceTokenInput) =>
    requestJson({
      path: "/api/service-tokens",
      method: "POST",
      body: ServiceTokenInputSchema.parse(input),
      schema: ServiceTokenCreatedSchema,
    }),
  revokeServiceToken: (id: string) =>
    requestJson({
      path: `/api/service-tokens/${id}`,
      method: "DELETE",
      schema: ServiceTokenSchema,
    }),
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
  updateAssetLifecycle: ({ id, input }: { id: string; input: AssetLifecycleInput }) =>
    requestJson({
      path: `/api/assets/${id}/lifecycle`,
      method: "PUT",
      body: AssetLifecycleInputSchema.parse(input),
      schema: AssetSchema,
    }),
  updateAssetTags: ({ id, input }: { id: string; input: AssetTagInput }) =>
    requestJson({
      path: `/api/assets/${id}/tags`,
      method: "PUT",
      body: AssetTagInputSchema.parse(input),
      schema: AssetSchema,
    }),
  deleteAsset: (id: string) => requestEmpty({ path: `/api/assets/${id}`, method: "DELETE" }),
}
