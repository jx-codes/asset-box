import { describe, expect, it } from "vitest"
import { authenticateServiceTokenHash, revokeServiceToken } from "./service-token-repository"

type DatabaseCapture = {
  sql: string
  bindings: unknown[]
}

function fakeDatabase({ firstResult }: { firstResult: unknown }) {
  const capture: DatabaseCapture = { sql: "", bindings: [] }
  const statement = {
    bind: (...bindings: unknown[]) => {
      capture.bindings = bindings
      return statement
    },
    first: async () => firstResult,
  }
  const db = {
    prepare: (sql: string) => {
      capture.sql = sql
      return statement
    },
  }
  return { db: db as unknown as D1Database, capture }
}

describe("service token repository", () => {
  it("authenticates and records last use in one conditional write", async () => {
    const { db, capture } = fakeDatabase({
      firstResult: { id: "7a4d4991-42a7-4804-8cf7-bb7a625c51a9" },
    })
    const now = new Date("2026-07-17T12:00:00.000Z")

    const result = await authenticateServiceTokenHash({
      db,
      tokenHash: "a".repeat(64),
      now,
    })

    expect(result).toEqual({
      tag: "found",
      value: { id: "7a4d4991-42a7-4804-8cf7-bb7a625c51a9" },
    })
    expect(capture.sql).toContain("SET last_used_at = ?")
    expect(capture.sql).toContain("revoked_at IS NULL")
    expect(capture.sql).toContain("expires_at > ?")
    expect(capture.sql).toContain("RETURNING id")
    expect(capture.bindings).toEqual([
      "2026-07-17T12:00:00.000Z",
      "a".repeat(64),
      "2026-07-17T12:00:00.000Z",
    ])
  })

  it("returns an explicit missing result when no active token matches", async () => {
    const { db } = fakeDatabase({ firstResult: null })

    const result = await authenticateServiceTokenHash({
      db,
      tokenHash: "b".repeat(64),
      now: new Date("2026-07-17T12:00:00.000Z"),
    })

    expect(result).toEqual({ tag: "missing" })
  })

  it("returns revoked metadata after making revocation durable", async () => {
    const { db, capture } = fakeDatabase({
      firstResult: {
        id: "7a4d4991-42a7-4804-8cf7-bb7a625c51a9",
        name: "Local CLI",
        prefix: "abx_abcdefgh",
        created_at: "2026-07-17T10:00:00.000Z",
        last_used_at: null,
        expires_at: null,
        revoked_at: "2026-07-17T12:00:00.000Z",
      },
    })

    const result = await revokeServiceToken({
      db,
      id: "7a4d4991-42a7-4804-8cf7-bb7a625c51a9",
      now: new Date("2026-07-17T12:00:00.000Z"),
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) throw result
    expect(result.status).toEqual({
      tag: "revoked",
      revokedAt: "2026-07-17T12:00:00.000Z",
    })
    expect(capture.sql).toContain("revoked_at = COALESCE(revoked_at, ?)")
  })
})
