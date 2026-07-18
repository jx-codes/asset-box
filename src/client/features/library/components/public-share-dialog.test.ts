import { describe, expect, it } from "vitest"
import { parsePublicShareForm } from "./public-share-dialog"

describe("public share form", () => {
  it("creates a never-expiring share when expiration is empty", () => {
    const form = new FormData()
    form.set("name", "Client review")
    form.set("expiresAt", "")

    expect(parsePublicShareForm(form)).toEqual({ name: "Client review" })
  })

  it("normalizes a scheduled expiration at the form boundary", () => {
    const form = new FormData()
    form.set("name", "Launch preview")
    form.set("expiresAt", "2026-07-19T10:30")

    const result = parsePublicShareForm(form)

    expect(result).not.toBeInstanceOf(Error)
    expect(result).toMatchObject({ name: "Launch preview", expiresAt: expect.any(String) })
  })

  it("rejects an empty label and invalid expiration", () => {
    const emptyName = new FormData()
    emptyName.set("name", "")
    emptyName.set("expiresAt", "")
    const invalidExpiration = new FormData()
    invalidExpiration.set("name", "Client review")
    invalidExpiration.set("expiresAt", "not-a-date")

    expect(parsePublicShareForm(emptyName)).toBeInstanceOf(Error)
    expect(parsePublicShareForm(invalidExpiration)).toBeInstanceOf(Error)
  })
})
