import { describe, expect, it } from "vitest"
import { hashAssetBytes, MAX_ASSET_BYTES, validateHtmlBytes } from "./html-content"

describe("HTML asset content", () => {
  it("accepts complete documents and gives identical bytes the same content id", async () => {
    const bytes = new TextEncoder().encode("<!doctype html><html><body>Hello</body></html>")

    const first = await hashAssetBytes(bytes)
    const second = await hashAssetBytes(bytes)

    expect(validateHtmlBytes(bytes)).not.toBeInstanceOf(Error)
    expect(first).toBe(second)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
  })

  it("rejects fragments, empty documents, and oversized documents", () => {
    expect(validateHtmlBytes(new Uint8Array())).toBeInstanceOf(Error)
    expect(
      validateHtmlBytes(new TextEncoder().encode("<section>fragment</section>")),
    ).toBeInstanceOf(Error)
    expect(validateHtmlBytes(new Uint8Array(MAX_ASSET_BYTES + 1))).toBeInstanceOf(Error)
  })
})
