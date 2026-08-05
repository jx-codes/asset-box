import { describe, expect, it } from "vitest"
import { AssetFilePathSchema } from "@/shared/domain"
import {
  ASSET_ENTRY_PATH,
  hashAssetResource,
  resolveAssetRequestPath,
  validateAssetResource,
} from "./resource"

const html = (body: string) =>
  new TextEncoder().encode(`<!doctype html><html><body>${body}</body></html>`)

describe("multi-page asset resources", () => {
  it("gives the same content id to the same path-content map regardless of upload order", async () => {
    const files = [
      { path: ASSET_ENTRY_PATH, bytes: html("Home") },
      { path: "guides/setup.html", bytes: html("Setup") },
    ]

    const first = await hashAssetResource(files)
    const second = await hashAssetResource([...files].reverse())

    expect(first).toBe(second)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
  })

  it("changes the resource id when either a path or page content changes", async () => {
    const original = await hashAssetResource([
      { path: ASSET_ENTRY_PATH, bytes: html("Home") },
      { path: "about.html", bytes: html("About") },
    ])
    const changedPath = await hashAssetResource([
      { path: ASSET_ENTRY_PATH, bytes: html("Home") },
      { path: "company.html", bytes: html("About") },
    ])
    const changedContent = await hashAssetResource([
      { path: ASSET_ENTRY_PATH, bytes: html("Home") },
      { path: "about.html", bytes: html("Updated") },
    ])

    expect(changedPath).not.toBe(original)
    expect(changedContent).not.toBe(original)
  })

  it("requires a safe, unique index.html entrypoint and complete HTML documents", () => {
    expect(validateAssetResource([{ path: "about.html", bytes: html("About") }])).toBeInstanceOf(
      Error,
    )
    expect(
      validateAssetResource([
        { path: ASSET_ENTRY_PATH, bytes: html("Home") },
        { path: ASSET_ENTRY_PATH, bytes: html("Duplicate") },
      ]),
    ).toBeInstanceOf(Error)
    expect(
      validateAssetResource([
        { path: ASSET_ENTRY_PATH, bytes: new TextEncoder().encode("fragment") },
      ]),
    ).toBeInstanceOf(Error)
    expect(AssetFilePathSchema.safeParse("../escape.html").success).toBe(false)
    expect(AssetFilePathSchema.safeParse("guides/setup.html").success).toBe(true)
  })

  it("resolves resource roots and nested directory URLs to index.html", () => {
    expect(resolveAssetRequestPath("")).toBe("index.html")
    expect(resolveAssetRequestPath("guides/")).toBe("guides/index.html")
    expect(resolveAssetRequestPath("guides/setup.html")).toBe("guides/setup.html")
    expect(resolveAssetRequestPath("../escape.html")).toBeInstanceOf(Error)
  })
})
