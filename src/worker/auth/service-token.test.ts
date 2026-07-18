import { describe, expect, it } from "vitest"
import { createServiceTokenMaterial, hashServiceToken, isServiceToken } from "./service-token"

const deterministicBytes = () => Uint8Array.from({ length: 32 }, (_, index) => index)

describe("service token material", () => {
  it("creates a 256-bit bearer token with a non-secret display prefix", async () => {
    const material = await createServiceTokenMaterial({ randomBytes: deterministicBytes })
    if (material instanceof Error) throw material

    expect(material.token).toMatch(/^abx_[A-Za-z0-9_-]{43}$/)
    expect(material.prefix).toBe(material.token.slice(0, 12))
    expect(material.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(material.tokenHash).not.toContain(material.token)
  })

  it("hashes the same token to the same lookup key", async () => {
    const material = await createServiceTokenMaterial({ randomBytes: deterministicBytes })
    if (material instanceof Error) throw material

    const repeatedHash = await hashServiceToken(material.token)

    expect(repeatedHash).toBe(material.tokenHash)
  })

  it("rejects malformed bearer values before database authentication", () => {
    expect(isServiceToken("abx_short")).toBe(false)
    expect(isServiceToken(`abx_${"a".repeat(43)}`)).toBe(true)
    expect(isServiceToken(`password_${"a".repeat(43)}`)).toBe(false)
  })

  it("rejects random sources that do not provide 256 bits", async () => {
    const material = await createServiceTokenMaterial({ randomBytes: () => new Uint8Array(31) })

    expect(material).toBeInstanceOf(Error)
  })
})
