import { z } from "@hono/zod-openapi"

export const TagSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens")
  .openapi("TagSlug")

export const TagSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(40),
    slug: TagSlugSchema,
    guidance: z.string().min(1).max(280),
    createdAt: z.string().datetime(),
  })
  .openapi("Tag")

export const TagInputSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    slug: TagSlugSchema,
    guidance: z.string().trim().min(1).max(280),
  })
  .openapi("TagInput")

export const AssetIdSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected a SHA-256 asset identifier")
  .openapi("AssetId")

export const AssetLifecycleSchema = z
  .discriminatedUnion("tag", [
    z.object({ tag: z.literal("active") }),
    z.object({ tag: z.literal("archived"), archivedAt: z.string().datetime() }),
  ])
  .openapi("AssetLifecycle")

export const AssetLifecycleInputSchema = z
  .discriminatedUnion("tag", [
    z.object({ tag: z.literal("active") }),
    z.object({ tag: z.literal("archived") }),
  ])
  .openapi("AssetLifecycleInput")

export const AssetTagInputSchema = z
  .object({ tagSlugs: z.array(TagSlugSchema).max(50) })
  .openapi("AssetTagInput")

export const LibraryViewSchema = z.enum(["active", "archived"]).openapi("LibraryView")

export const AssetSchema = z
  .object({
    id: AssetIdSchema,
    title: z.string().min(1).max(120),
    blurb: z.string().min(1).max(280),
    sizeBytes: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    lifecycle: AssetLifecycleSchema,
    tags: z.array(TagSchema),
  })
  .openapi("Asset")

export const LibrarySchema = z
  .object({
    assets: z.array(AssetSchema),
    tags: z.array(TagSchema),
  })
  .openapi("Library")

export const SessionSchema = z.object({ authenticated: z.boolean() }).openapi("Session")

export const LoginInputSchema = z
  .object({ password: z.string().min(1).max(1024) })
  .openapi("LoginInput")

export const ServiceTokenSecretSchema = z
  .string()
  .regex(/^abx_[A-Za-z0-9_-]{43}$/)
  .openapi("ServiceTokenSecret")

export const ServiceTokenInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    expiresAt: z.string().datetime().optional(),
  })
  .openapi("ServiceTokenInput")

export const ServiceTokenUsageSchema = z
  .discriminatedUnion("tag", [
    z.object({ tag: z.literal("never-used") }),
    z.object({ tag: z.literal("used"), lastUsedAt: z.string().datetime() }),
  ])
  .openapi("ServiceTokenUsage")

export const ServiceTokenExpirationSchema = z
  .discriminatedUnion("tag", [
    z.object({ tag: z.literal("never") }),
    z.object({ tag: z.literal("scheduled"), expiresAt: z.string().datetime() }),
  ])
  .openapi("ServiceTokenExpiration")

export const ServiceTokenStatusSchema = z
  .discriminatedUnion("tag", [
    z.object({ tag: z.literal("active"), expiration: ServiceTokenExpirationSchema }),
    z.object({ tag: z.literal("expired"), expiredAt: z.string().datetime() }),
    z.object({ tag: z.literal("revoked"), revokedAt: z.string().datetime() }),
  ])
  .openapi("ServiceTokenStatus")

export const ServiceTokenSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(80),
    prefix: z.string().regex(/^abx_[A-Za-z0-9_-]{8}$/),
    createdAt: z.string().datetime(),
    usage: ServiceTokenUsageSchema,
    status: ServiceTokenStatusSchema,
  })
  .openapi("ServiceToken")

export const ServiceTokenListSchema = z
  .object({ serviceTokens: z.array(ServiceTokenSchema) })
  .openapi("ServiceTokenList")

export const ServiceTokenCreatedSchema = z
  .object({
    serviceToken: ServiceTokenSchema,
    token: ServiceTokenSecretSchema,
  })
  .openapi("ServiceTokenCreated")

export const UploadResponseSchema = z
  .object({
    status: z.enum(["created", "duplicate"]),
    asset: AssetSchema,
  })
  .openapi("UploadResponse")

export const ApiErrorCodeSchema = z.enum([
  "AUTH_REQUIRED",
  "INVALID_CREDENTIALS",
  "LOGIN_THROTTLED",
  "INVALID_INPUT",
  "ASSET_NOT_FOUND",
  "ASSET_DELETE_PENDING",
  "SERVICE_TOKEN_NOT_FOUND",
  "PUBLIC_SHARE_NOT_FOUND",
  "WORK_REQUEST_NOT_FOUND",
  "WORK_REQUEST_STATE_CONFLICT",
  "WORK_COMMENT_NOT_FOUND",
  "WORK_NOT_SUBMITTED",
  "WORK_ALREADY_CLAIMED",
  "WORK_CLAIM_NOT_FOUND",
  "WORK_CLAIM_EXPIRED",
  "WORK_CLAIM_FAILED",
  "WORK_CLAIM_FORBIDDEN",
  "WORK_RESULT_CONFLICT",
  "TAG_NOT_FOUND",
  "TAG_CONFLICT",
  "UNKNOWN_TAG",
  "STORAGE_FAILURE",
  "DATABASE_FAILURE",
  "INTERNAL_FAILURE",
])

export const ApiErrorSchema = z
  .object({
    error: z.object({
      code: ApiErrorCodeSchema,
      message: z.string(),
      retryAfterSeconds: z.number().int().positive().optional(),
    }),
  })
  .openapi("ApiError")

export type AssetLifecycle = z.infer<typeof AssetLifecycleSchema>
export type AssetLifecycleInput = z.infer<typeof AssetLifecycleInputSchema>
export type AssetTagInput = z.infer<typeof AssetTagInputSchema>
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>
export type ApiErrorPayload = z.infer<typeof ApiErrorSchema>
export type Asset = z.infer<typeof AssetSchema>
export type Library = z.infer<typeof LibrarySchema>
export type LibraryView = z.infer<typeof LibraryViewSchema>
export type LoginInput = z.infer<typeof LoginInputSchema>
export type Session = z.infer<typeof SessionSchema>
export type ServiceToken = z.infer<typeof ServiceTokenSchema>
export type ServiceTokenCreated = z.infer<typeof ServiceTokenCreatedSchema>
export type ServiceTokenInput = z.infer<typeof ServiceTokenInputSchema>
export type ServiceTokenList = z.infer<typeof ServiceTokenListSchema>
export type Tag = z.infer<typeof TagSchema>
export type TagInput = z.infer<typeof TagInputSchema>
export type UploadResponse = z.infer<typeof UploadResponseSchema>
