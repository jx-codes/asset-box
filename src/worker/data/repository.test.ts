import { describe, expect, it } from "vitest"
import { beginAssetDeletion } from "./repository"

function fakeDatabase() {
  const sql: string[] = []
  const statement = {
    bind: () => statement,
    first: async () => {
      if (sql.at(-1)?.includes("FROM assets WHERE id = ?")) {
        return {
          id: "a".repeat(64),
          title: "Parent asset",
          blurb: "A parent with durable work history.",
          object_key: `assets/${"a".repeat(64)}.html`,
          size_bytes: 1024,
          created_at: "2026-07-18T10:00:00.000Z",
          archived_at: null,
          deleted_at: null,
        }
      }
      return { linked: 1 }
    },
    run: async () => ({ success: true, meta: { changes: 1 } }),
  }
  const db = {
    prepare: (query: string) => {
      sql.push(query)
      return statement
    },
  }
  return { db: db as unknown as D1Database, sql }
}

describe("asset deletion", () => {
  it("rejects deletion before R2 cleanup when durable work references the asset", async () => {
    const { db, sql } = fakeDatabase()

    const result = await beginAssetDeletion({
      db,
      id: "a".repeat(64),
      now: new Date("2026-07-18T11:00:00.000Z"),
    })

    expect(result).toBeInstanceOf(Error)
    expect(result).toMatchObject({ _tag: "AssetWorkLinkedError" })
    expect(sql.some((query) => query.includes("UPDATE assets SET deleted_at"))).toBe(false)
  })
})
