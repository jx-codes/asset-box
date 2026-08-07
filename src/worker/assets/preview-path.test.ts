import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { assetPreviewPath, parseAssetPreviewRequest, parseAssetViewRequest } from "./preview-path"

const origin = "https://asset-box.example"
const assetId = "a".repeat(64)
const token = "signed.preview-token"

describe("asset preview paths", () => {
  it("keeps relative page links inside the signed preview route", () => {
    const entryUrl = new URL(assetPreviewPath({ assetId, token }), origin)

    expect(new URL("audience.html", entryUrl).pathname).toBe(
      `/view/${assetId}/_preview/${token}/audience.html`,
    )
  })

  it("keeps nested directory index navigation inside the signed preview route", () => {
    const entryUrl = new URL(assetPreviewPath({ assetId, token }), origin)
    const directoryUrl = new URL("guides/", entryUrl)

    expect(directoryUrl.pathname).toBe(`/view/${assetId}/_preview/${token}/guides/`)
    expect(new URL("index.html", directoryUrl).pathname).toBe(
      `/view/${assetId}/_preview/${token}/guides/index.html`,
    )
  })

  it("includes an existing nested file path after the capability segment", () => {
    expect(assetPreviewPath({ assetId, token, path: "guides/setup.html" })).toBe(
      `/view/${assetId}/_preview/${token}/guides/setup.html`,
    )
  })

  it("matches signed tokens and nested files with the production Hono route shape", async () => {
    const app = new Hono()
    app.get("/view/:id/_preview/*", (c) => {
      const request = parseAssetPreviewRequest({
        requestPath: c.req.path,
        assetId: c.req.param("id"),
      })
      return c.json(request)
    })

    const response = await app.request(assetPreviewPath({ assetId, token, path: "audience.html" }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      tag: "asset-preview-request",
      token,
      path: "audience.html",
    })
  })

  it("extracts nested files from the ordinary authenticated Hono route", async () => {
    const app = new Hono()
    app.get("/view/:id/*", (c) =>
      c.json(parseAssetViewRequest({ requestPath: c.req.path, assetId: c.req.param("id") })),
    )

    const response = await app.request(`/view/${assetId}/guides/setup.html`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      tag: "asset-view-request",
      path: "guides/setup.html",
    })
  })

  it("round-trips encoded HTML file paths through the preview URL", () => {
    const requestPath = assetPreviewPath({ assetId, token, path: "team notes/index.html" })

    expect(requestPath).toContain("team%20notes/index.html")
    expect(parseAssetPreviewRequest({ requestPath, assetId })).toEqual({
      tag: "asset-preview-request",
      token,
      path: "team notes/index.html",
    })
  })
})
