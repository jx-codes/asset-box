import { describe, expect, it } from "vitest"
import { publicSharePage, publicSharePageResponse, publicShareUnavailableResponse } from "./page"

const token = `abp_${"a".repeat(43)}`

describe("public share page", () => {
  it("escapes asset metadata and keeps preview and download on capability-scoped routes", () => {
    const page = publicSharePage({
      token,
      title: '<script>alert("title")</script>',
      blurb: "A&B's asset",
    })

    expect(page).not.toContain('<script>alert("title")</script>')
    expect(page).toContain("&lt;script&gt;alert(&quot;title&quot;)&lt;/script&gt;")
    expect(page).toContain("A&amp;B&#39;s asset")
    expect(page).toContain(`/share/${token}/content`)
    expect(page).toContain(`/share/${token}/download`)
  })

  it("prevents cached or indexed copies from surviving revocation", () => {
    const response = publicSharePageResponse({ token, title: "Shared asset", blurb: "Preview" })
    const unavailable = publicShareUnavailableResponse()

    expect(response.headers.get("Cache-Control")).toContain("no-store")
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex")
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-src 'self'")
    expect(unavailable.status).toBe(404)
  })
})
