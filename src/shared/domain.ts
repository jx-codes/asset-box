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

export const AssetSchema = z
  .object({
    id: AssetIdSchema,
    title: z.string().min(1).max(120),
    blurb: z.string().min(1).max(280),
    sizeBytes: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
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

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>
export type ApiErrorPayload = z.infer<typeof ApiErrorSchema>
export type Asset = z.infer<typeof AssetSchema>
export type Library = z.infer<typeof LibrarySchema>
export type LoginInput = z.infer<typeof LoginInputSchema>
export type Session = z.infer<typeof SessionSchema>
export type Tag = z.infer<typeof TagSchema>
export type TagInput = z.infer<typeof TagInputSchema>
export type UploadResponse = z.infer<typeof UploadResponseSchema>
