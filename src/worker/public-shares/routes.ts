import { type OpenAPIHono, z } from "@hono/zod-openapi"
import { AssetIdSchema } from "@/shared/domain"
import { ASSET_ENTRY_PATH, resolveAssetRequestPath } from "../assets/resource"
import {
  PublicShareCreateInputSchema,
  PublicShareCreatedSchema,
  PublicShareIdSchema,
  PublicShareListSchema,
  PublicShareSchema,
} from "@/shared/public-shares"
import { assetHtmlResponse } from "../assets/response"
import { authorizeBrowserSession } from "../auth/authorize"
import {
  insertPublicShare,
  listPublicShares,
  revokePublicShare,
} from "../data/public-share-repository"
import { InvalidInputError, PublicShareUnavailableError } from "../errors"
import {
  type AppContext,
  commonErrorResponses,
  jsonContent,
  parseJsonInput,
  respondError,
} from "../http"
import { broadcastEvent, notifyClients } from "../realtime"
import { requireAsset } from "../data/repository"
import { createPublicShareTokenMaterial } from "./material"
import { publicSharePageResponse, publicShareUnavailableResponse } from "./page"
import { downloadPublicShare, openPublicShare, readPublicShareContent } from "./service"

const browserSessionSecurity: Record<string, string[]>[] = [{ sessionCookie: [] }]

function publicRouteError(error: Error) {
  if (PublicShareUnavailableError.is(error)) return publicShareUnavailableResponse()
  console.error("Public share request failed", error)
  return new Response("Asset Box could not open this share", {
    status: 500,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  })
}

function parseAssetId(value: string) {
  const parsed = AssetIdSchema.safeParse(value)
  if (!parsed.success) return new InvalidInputError({ reason: "Asset id is invalid" })
  return parsed.data
}

function parseShareId(value: string) {
  const parsed = PublicShareIdSchema.safeParse(value)
  if (!parsed.success) return new InvalidInputError({ reason: "Public share id is invalid" })
  return parsed.data
}

export function registerPublicShareRoutes(app: OpenAPIHono<AppContext>) {
  app.get("/share/:token", async (c) => {
    const opened = await openPublicShare({
      env: c.env,
      token: c.req.param("token"),
      now: new Date(),
    })
    if (opened instanceof Error) return publicRouteError(opened)
    await broadcastEvent({
      env: c.env,
      event: { tag: "public-shares-changed", assetId: opened.target.asset_id },
    })
    return publicSharePageResponse({
      token: c.req.param("token"),
      title: opened.target.title,
      blurb: opened.target.blurb,
    })
  })

  app.get("/share/:token/content", async (c) => {
    const content = await readPublicShareContent({
      env: c.env,
      token: c.req.param("token"),
      now: new Date(),
    })
    if (content instanceof Error) return publicRouteError(content)
    return assetHtmlResponse({
      body: content.object.body,
      cacheControl: "no-store, private",
      disposition: "inline",
      filename: `${content.target.asset_id}.html`,
    })
  })

  app.get("/share/:token/content/*", async (c) => {
    const path = resolveAssetRequestPath(c.req.param("*"))
    if (path instanceof Error) return publicShareUnavailableResponse()
    const content = await readPublicShareContent({
      env: c.env,
      token: c.req.param("token"),
      now: new Date(),
      source: { tag: "file", path },
    })
    if (content instanceof Error) return publicRouteError(content)
    return assetHtmlResponse({
      body: content.object.body,
      cacheControl: "no-store, private",
      disposition: "inline",
      filename: path.split("/").at(-1) ?? ASSET_ENTRY_PATH,
    })
  })

  app.get("/share/:token/download", async (c) => {
    const download = await downloadPublicShare({
      env: c.env,
      token: c.req.param("token"),
      now: new Date(),
    })
    if (download instanceof Error) return publicRouteError(download)
    await broadcastEvent({
      env: c.env,
      event: { tag: "public-shares-changed", assetId: download.target.asset_id },
    })
    return assetHtmlResponse({
      body: download.object.body,
      cacheControl: "no-store, private",
      disposition: "attachment",
      filename: `${download.target.asset_id}.html`,
    })
  })

  app.get("/api/assets/:id/public-shares", async (c) => {
    const auth = await authorizeBrowserSession(c)
    if (auth instanceof Error) return respondError(c, auth)
    const assetId = parseAssetId(c.req.param("id"))
    if (assetId instanceof Error) return respondError(c, assetId)
    const asset = await requireAsset({ db: c.env.ASSET_BOX_DB, id: assetId })
    if (asset instanceof Error) return respondError(c, asset)

    const shares = await listPublicShares({ db: c.env.ASSET_BOX_DB, assetId, now: new Date() })
    if (shares instanceof Error) return respondError(c, shares)
    return c.json(shares)
  })

  app.post("/api/assets/:id/public-shares", async (c) => {
    const auth = await authorizeBrowserSession(c)
    if (auth instanceof Error) return respondError(c, auth)
    const assetId = parseAssetId(c.req.param("id"))
    if (assetId instanceof Error) return respondError(c, assetId)
    const input = await parseJsonInput({
      read: () => c.req.json(),
      schema: PublicShareCreateInputSchema,
    })
    if (input instanceof Error) return respondError(c, input)

    const now = new Date()
    if (input.expiresAt !== undefined && input.expiresAt <= now.toISOString()) {
      return respondError(
        c,
        new InvalidInputError({ reason: "Share expiration must be in the future" }),
      )
    }
    const asset = await requireAsset({ db: c.env.ASSET_BOX_DB, id: assetId })
    if (asset instanceof Error) return respondError(c, asset)
    const material = await createPublicShareTokenMaterial()
    if (material instanceof Error) return respondError(c, material)
    const publicShare = await insertPublicShare({
      db: c.env.ASSET_BOX_DB,
      id: crypto.randomUUID(),
      assetId,
      input,
      prefix: material.prefix,
      tokenHash: material.tokenHash,
      now,
    })
    if (publicShare instanceof Error) return respondError(c, publicShare)

    const created = PublicShareCreatedSchema.parse({
      publicShare,
      url: new URL(`/share/${material.token}`, c.req.url).toString(),
    })
    await notifyClients({
      c,
      event: { tag: "public-shares-changed", assetId },
    })
    return c.json(created, 201)
  })

  app.delete("/api/assets/:assetId/public-shares/:shareId", async (c) => {
    const auth = await authorizeBrowserSession(c)
    if (auth instanceof Error) return respondError(c, auth)
    const assetId = parseAssetId(c.req.param("assetId"))
    if (assetId instanceof Error) return respondError(c, assetId)
    const shareId = parseShareId(c.req.param("shareId"))
    if (shareId instanceof Error) return respondError(c, shareId)

    const publicShare = await revokePublicShare({
      db: c.env.ASSET_BOX_DB,
      assetId,
      id: shareId,
      now: new Date(),
    })
    if (publicShare instanceof Error) return respondError(c, publicShare)
    await notifyClients({
      c,
      event: { tag: "public-shares-changed", assetId },
    })
    return c.json(publicShare)
  })

  app.openAPIRegistry.registerPath({
    method: "get",
    path: "/api/assets/{id}/public-shares",
    tags: ["Public shares"],
    security: browserSessionSecurity,
    request: { params: z.object({ id: AssetIdSchema }) },
    responses: {
      ...commonErrorResponses,
      200: jsonContent(PublicShareListSchema, "Public shares for an asset"),
    },
  })
  app.openAPIRegistry.registerPath({
    method: "post",
    path: "/api/assets/{id}/public-shares",
    tags: ["Public shares"],
    security: browserSessionSecurity,
    request: {
      params: z.object({ id: AssetIdSchema }),
      body: { content: { "application/json": { schema: PublicShareCreateInputSchema } } },
    },
    responses: {
      ...commonErrorResponses,
      201: jsonContent(PublicShareCreatedSchema, "Created public share and one-time URL"),
    },
  })
  app.openAPIRegistry.registerPath({
    method: "delete",
    path: "/api/assets/{assetId}/public-shares/{shareId}",
    tags: ["Public shares"],
    security: browserSessionSecurity,
    request: {
      params: z.object({ assetId: AssetIdSchema, shareId: PublicShareIdSchema }),
    },
    responses: {
      ...commonErrorResponses,
      200: jsonContent(PublicShareSchema, "Public share taken offline"),
    },
  })
}
