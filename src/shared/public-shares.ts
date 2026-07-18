import { z } from "@hono/zod-openapi"
import { AssetIdSchema } from "./domain"

export const PublicShareIdSchema = z.string().uuid().openapi("PublicShareId")

export const PublicShareSecretSchema = z
  .string()
  .regex(/^abp_[A-Za-z0-9_-]{43}$/)
  .openapi("PublicShareSecret")

export const PublicShareNameSchema = z.string().trim().min(1).max(80).openapi("PublicShareName")

export const PublicShareCreateInputSchema = z
  .object({
    name: PublicShareNameSchema,
    expiresAt: z.string().datetime().optional(),
  })
  .openapi("PublicShareCreateInput")

export const PublicShareExpirationSchema = z
  .discriminatedUnion("tag", [
    z.object({ tag: z.literal("never") }),
    z.object({ tag: z.literal("scheduled"), expiresAt: z.string().datetime() }),
  ])
  .openapi("PublicShareExpiration")

export const PublicShareStatusSchema = z
  .discriminatedUnion("tag", [
    z.object({ tag: z.literal("active"), expiration: PublicShareExpirationSchema }),
    z.object({ tag: z.literal("expired"), expiredAt: z.string().datetime() }),
    z.object({ tag: z.literal("revoked"), revokedAt: z.string().datetime() }),
  ])
  .openapi("PublicShareStatus")

export const PublicShareViewActivitySchema = z
  .discriminatedUnion("tag", [
    z.object({ tag: z.literal("never-viewed") }),
    z.object({
      tag: z.literal("viewed"),
      count: z.number().int().positive(),
      lastViewedAt: z.string().datetime(),
    }),
  ])
  .openapi("PublicShareViewActivity")

export const PublicShareDownloadActivitySchema = z
  .discriminatedUnion("tag", [
    z.object({ tag: z.literal("never-downloaded") }),
    z.object({
      tag: z.literal("downloaded"),
      count: z.number().int().positive(),
      lastDownloadedAt: z.string().datetime(),
    }),
  ])
  .openapi("PublicShareDownloadActivity")

export const PublicShareSchema = z
  .object({
    id: PublicShareIdSchema,
    assetId: AssetIdSchema,
    name: PublicShareNameSchema,
    prefix: z.string().regex(/^abp_[A-Za-z0-9_-]{8}$/),
    createdAt: z.string().datetime(),
    status: PublicShareStatusSchema,
    views: PublicShareViewActivitySchema,
    downloads: PublicShareDownloadActivitySchema,
  })
  .openapi("PublicShare")

export const PublicShareCreatedSchema = z
  .object({
    publicShare: PublicShareSchema,
    url: z.url(),
  })
  .openapi("PublicShareCreated")

export const PublicShareListSchema = z
  .object({ publicShares: z.array(PublicShareSchema) })
  .openapi("PublicShareList")

export type PublicShare = z.infer<typeof PublicShareSchema>
export type PublicShareCreateInput = z.infer<typeof PublicShareCreateInputSchema>
export type PublicShareCreated = z.infer<typeof PublicShareCreatedSchema>
export type PublicShareList = z.infer<typeof PublicShareListSchema>
