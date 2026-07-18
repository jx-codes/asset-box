import { z } from "@hono/zod-openapi"
import { AssetSchema } from "./domain"
import { WorkRequestIdSchema } from "./work-requests"

export const AssetEventSchema = z.discriminatedUnion("tag", [
  z.object({ tag: z.literal("connected") }),
  z.object({ tag: z.literal("asset-created"), asset: AssetSchema }),
  z.object({ tag: z.literal("asset-updated"), asset: AssetSchema }),
  z.object({ tag: z.literal("asset-deleted"), assetId: z.string() }),
  z.object({ tag: z.literal("tags-changed") }),
  z.object({ tag: z.literal("work-request-changed"), requestId: WorkRequestIdSchema }),
  z.object({
    tag: z.literal("work-result-created"),
    requestId: WorkRequestIdSchema,
    asset: AssetSchema,
  }),
])

export type AssetEvent = z.infer<typeof AssetEventSchema>
