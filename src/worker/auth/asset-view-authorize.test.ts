// @vitest-environment node

import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import type { Env } from "../env"
import { authorizeAssetView } from "./authorize"
import { createAssetPreviewToken } from "./session"

const secret = "a-long-test-secret-that-is-not-used-in-production"
const assetId = "a".repeat(64)
const otherAssetId = "b".repeat(64)

const app = new Hono<{ Bindings: Env }>()
app.get("/view/:id/*", async (c) => {
  const authorization = await authorizeAssetView(c, c.req.param("id"))
  if (authorization instanceof Error) return c.json({ authorized: false }, 401)
  return c.json({ authorized: true, principal: authorization.tag })
})

const env = { SESSION_SECRET: secret } as Env

describe("nested asset preview authorization", () => {
  it("accepts the scoped preview cookie when the Strict browser session is unavailable", async () => {
    const token = await createAssetPreviewToken({
      assetId,
      secret,
      now: new Date(),
    })
    if (token instanceof Error) throw token

    const response = await app.request(
      `/view/${assetId}/guides/index.html`,
      { headers: { Cookie: `asset_box_preview=${token}` } },
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      authorized: true,
      principal: "asset-preview",
    })
  })

  it("rejects a preview cookie on another asset path", async () => {
    const token = await createAssetPreviewToken({
      assetId,
      secret,
      now: new Date(),
    })
    if (token instanceof Error) throw token

    const response = await app.request(
      `/view/${otherAssetId}/index.html`,
      { headers: { Cookie: `asset_box_preview=${token}` } },
      env,
    )

    expect(response.status).toBe(401)
  })
})
