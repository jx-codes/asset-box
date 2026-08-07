import type { Context } from "hono"
import type { OpenAPIHono } from "@hono/zod-openapi"
import { AssetIdSchema } from "@/shared/domain"
import { authorize } from "../auth/authorize"
import { createAssetPreviewToken, verifyAssetPreviewToken } from "../auth/session"
import { findAssetFile, requireAsset } from "../data/repository"
import { AuthRequiredError, InvalidInputError, StorageFailureError } from "../errors"
import type { AppContext } from "../http"
import { respondError } from "../http"
import { assetPreviewPath, parseAssetPreviewRequest, parseAssetViewRequest } from "./preview-path"
import { ASSET_ENTRY_PATH, resolveAssetRequestPath } from "./resource"
import { assetHtmlResponse } from "./response"

export function registerAssetViewRoutes(app: OpenAPIHono<AppContext>) {
  app.get("/view/:id", async (c) => {
    const auth = await authorize(c)
    if (auth instanceof Error) return respondError(c, auth)
    const id = AssetIdSchema.safeParse(c.req.param("id"))
    if (!id.success) {
      return respondError(c, new InvalidInputError({ reason: "Asset id is invalid" }))
    }
    const metadata = await requireAsset({ db: c.env.ASSET_BOX_DB, id: id.data })
    if (metadata instanceof Error) return respondError(c, metadata)
    const file = await findAssetFile({
      db: c.env.ASSET_BOX_DB,
      assetId: id.data,
      path: ASSET_ENTRY_PATH,
    })
    if (file instanceof Error) return respondError(c, file)
    if (file.tag === "missing") {
      return c.json(
        { error: { code: "ASSET_NOT_FOUND" as const, message: "Asset file not found" } },
        404,
      )
    }
    if (file.value.object_key !== `assets/${id.data}.html`) {
      if (auth.tag === "browser-session") {
        const previewToken = await createAssetPreviewToken({
          assetId: id.data,
          secret: c.env.SESSION_SECRET,
          now: new Date(),
        })
        if (previewToken instanceof Error) return respondError(c, previewToken)
        c.header("Cache-Control", "no-store")
        return c.redirect(assetPreviewPath({ assetId: id.data, token: previewToken }), 307)
      }
      return c.redirect(`/view/${id.data}/`, 308)
    }
    const object = await c.env.ASSET_BOX_BUCKET.get(file.value.object_key).catch(
      (cause) => new StorageFailureError({ operation: "asset read", cause }),
    )
    if (object instanceof Error) return respondError(c, object)
    if (object === null) {
      return respondError(c, new StorageFailureError({ operation: "asset read" }))
    }
    return assetHtmlResponse({
      body: object.body,
      cacheControl: "private, max-age=3600",
      disposition: "inline",
      filename: `${id.data}.html`,
    })
  })

  app.get("/view/:id/_preview/*", async (c) => {
    const id = AssetIdSchema.safeParse(c.req.param("id"))
    if (!id.success) {
      return respondError(c, new InvalidInputError({ reason: "Asset id is invalid" }))
    }
    const previewRequest = parseAssetPreviewRequest({
      requestPath: c.req.path,
      assetId: id.data,
    })
    if (previewRequest.tag === "invalid-preview-request") {
      return respondError(c, new AuthRequiredError())
    }
    const authorized = await verifyAssetPreviewToken({
      token: previewRequest.token,
      assetId: id.data,
      secret: c.env.SESSION_SECRET,
      now: new Date(),
    })
    if (authorized instanceof Error) return respondError(c, authorized)
    if (!authorized) return respondError(c, new AuthRequiredError())

    const path = resolveAssetRequestPath(previewRequest.path)
    if (path instanceof Error) return respondError(c, path)
    return storedAssetFileResponse({ c, assetId: id.data, path })
  })

  app.get("/view/:id/*", async (c) => {
    const id = AssetIdSchema.safeParse(c.req.param("id"))
    if (!id.success) {
      return respondError(c, new InvalidInputError({ reason: "Asset id is invalid" }))
    }
    const auth = await authorize(c)
    if (auth instanceof Error) return respondError(c, auth)
    const assetViewRequest = parseAssetViewRequest({
      requestPath: c.req.path,
      assetId: id.data,
    })
    if (assetViewRequest.tag === "invalid-asset-view-request") {
      return respondError(c, new InvalidInputError({ reason: "Asset file path is invalid" }))
    }
    const path = resolveAssetRequestPath(assetViewRequest.path)
    if (path instanceof Error) return respondError(c, path)

    if (auth.tag === "browser-session") {
      const previewToken = await createAssetPreviewToken({
        assetId: id.data,
        secret: c.env.SESSION_SECRET,
        now: new Date(),
      })
      if (previewToken instanceof Error) return respondError(c, previewToken)
      c.header("Cache-Control", "no-store")
      return c.redirect(
        assetPreviewPath({ assetId: id.data, token: previewToken, path: assetViewRequest.path }),
        307,
      )
    }

    return storedAssetFileResponse({ c, assetId: id.data, path })
  })
}

async function storedAssetFileResponse({
  c,
  assetId,
  path,
}: {
  c: Context<AppContext>
  assetId: string
  path: string
}) {
  const metadata = await requireAsset({ db: c.env.ASSET_BOX_DB, id: assetId })
  if (metadata instanceof Error) return respondError(c, metadata)
  const file = await findAssetFile({ db: c.env.ASSET_BOX_DB, assetId, path })
  if (file instanceof Error) return respondError(c, file)
  if (file.tag === "missing") {
    return c.json(
      { error: { code: "ASSET_NOT_FOUND" as const, message: "Asset file not found" } },
      404,
    )
  }
  const object = await c.env.ASSET_BOX_BUCKET.get(file.value.object_key).catch(
    (cause) => new StorageFailureError({ operation: "asset file read", cause }),
  )
  if (object instanceof Error) return respondError(c, object)
  if (object === null) {
    return respondError(c, new StorageFailureError({ operation: "asset file read" }))
  }
  return assetHtmlResponse({
    body: object.body,
    cacheControl: "private, max-age=3600",
    disposition: "inline",
    filename: path.split("/").at(-1) ?? ASSET_ENTRY_PATH,
  })
}
