import { describe, expect, it } from "vitest"
import app from "../index"
import type { Env } from "../env"

const env = {} as Env

describe("public share routes", () => {
  it("routes malformed public capabilities to a non-cacheable unavailable page", async () => {
    const response = await app.request("http://asset-box.test/share/not-a-capability", {}, env)

    expect(response.status).toBe(404)
    expect(response.headers.get("Cache-Control")).toContain("no-store")
    expect(response.headers.get("Content-Type")).toContain("text/html")
    expect(await response.text()).toContain("Share unavailable")
  })

  it("keeps share management behind browser authentication", async () => {
    const response = await app.request(
      `http://asset-box.test/api/assets/${"a".repeat(64)}/public-shares`,
      {},
      env,
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } })
  })
})
