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
    all: async () => ({
      success: true,
      results: [
        {
          asset_id: "a".repeat(64),
          path: "index.html",
          object_key: `assets/${"a".repeat(64)}.html`,
          size_bytes: 1024,
          content_sha256: "a".repeat(64),
        },
      ],
    }),
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
  it("tombstones an asset even when durable work references it", async () => {
    const { db, sql } = fakeDatabase()

    const result = await beginAssetDeletion({
      db,
      id: "a".repeat(64),
      now: new Date("2026-07-18T11:00:00.000Z"),
    })

    expect(result).toEqual({
      tag: "deleting",
      objectKeys: [`assets/${"a".repeat(64)}.html`],
    })
    expect(sql.some((query) => query.includes("work_requests"))).toBe(false)
    expect(sql.some((query) => query.includes("UPDATE assets SET deleted_at"))).toBe(true)
  })
})
