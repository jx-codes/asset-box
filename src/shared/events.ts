import { z } from "@hono/zod-openapi"
import { AssetSchema } from "./domain"

export const AssetEventSchema = z.discriminatedUnion("tag", [
  z.object({ tag: z.literal("connected") }),
  z.object({ tag: z.literal("asset-created"), asset: AssetSchema }),
])

export type AssetEvent = z.infer<typeof AssetEventSchema>
