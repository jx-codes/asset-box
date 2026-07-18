import { describe, expect, it } from "vitest"
import {
  createPublicShareTokenMaterial,
  hashPublicShareToken,
  isPublicShareToken,
} from "./material"

const deterministicBytes = () => Uint8Array.from({ length: 32 }, (_, index) => index)

describe("public share token material", () => {
  it("creates a 256-bit capability whose secret is not stored as its lookup key", async () => {
    const material = await createPublicShareTokenMaterial({ randomBytes: deterministicBytes })
    if (material instanceof Error) throw material

    expect(material.token).toMatch(/^abp_[A-Za-z0-9_-]{43}$/)
    expect(material.prefix).toBe(material.token.slice(0, 12))
    expect(material.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(material.tokenHash).not.toContain(material.token)
    expect(await hashPublicShareToken(material.token)).toBe(material.tokenHash)
  })

  it("rejects malformed links and non-256-bit random sources", async () => {
    expect(isPublicShareToken("abp_short")).toBe(false)
    expect(isPublicShareToken(`abp_${"a".repeat(43)}`)).toBe(true)

    const material = await createPublicShareTokenMaterial({ randomBytes: () => new Uint8Array(31) })
    expect(material).toBeInstanceOf(Error)
  })
})
