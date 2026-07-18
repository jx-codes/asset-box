import { describe, expect, it } from "vitest"
import {
  findActivePublicShareTarget,
  listPublicShares,
  recordPublicShareAccess,
  revokePublicShare,
} from "./public-share-repository"

const assetId = "a".repeat(64)
const shareId = "9a232244-4e6b-4592-ad15-6ca4e2a0e45f"
const now = new Date("2026-07-18T10:00:00.000Z")

type CapturedStatement = { sql: string; bindings: unknown[] }

function statement(
  sql: string,
  captured: CapturedStatement[],
  results: { first?: unknown; all?: unknown[] },
) {
  const capture = { sql, bindings: [] as unknown[] }
  captured.push(capture)
  const value = {
    bind: (...bindings: unknown[]) => {
      capture.bindings = bindings
      return value
    },
    first: async () => results.first ?? null,
    all: async () => ({ success: true, results: results.all ?? [] }),
  }
  return value as unknown as D1PreparedStatement
}

const activeRow = {
  id: shareId,
  asset_id: assetId,
  name: "Client review",
  token_prefix: "abp_abcdefgh",
  created_at: "2026-07-18T09:00:00.000Z",
  expires_at: null,
  revoked_at: null,
  view_count: 2,
  last_viewed_at: "2026-07-18T09:45:00.000Z",
  download_count: 1,
  last_downloaded_at: "2026-07-18T09:50:00.000Z",
}

describe("public share repository", () => {
  it("projects durable access and download activity for private management", async () => {
    const captured: CapturedStatement[] = []
    const db = {
      prepare: (sql: string) => statement(sql, captured, { all: [activeRow] }),
    } as unknown as D1Database

    const result = await listPublicShares({ db, assetId, now })

    expect(result).toMatchObject({
      publicShares: [
        {
          id: shareId,
          status: { tag: "active", expiration: { tag: "never" } },
          views: { tag: "viewed", count: 2 },
          downloads: { tag: "downloaded", count: 1 },
        },
      ],
    })
    expect(captured[0]?.sql).not.toContain("token_hash")
  })

  it("requires an active token and a non-deleted asset for public lookup", async () => {
    const captured: CapturedStatement[] = []
    const db = {
      prepare: (sql: string) =>
        statement(sql, captured, {
          first: {
            share_id: shareId,
            asset_id: assetId,
            title: "Shared asset",
            blurb: "Public preview",
            object_key: `assets/${assetId}.html`,
          },
        }),
    } as unknown as D1Database

    const result = await findActivePublicShareTarget({ db, tokenHash: "b".repeat(64), now })

    expect(result).toMatchObject({ share_id: shareId, asset_id: assetId })
    expect(captured[0]?.sql).toContain("asset.deleted_at IS NULL")
    expect(captured[0]?.sql).toContain("share.revoked_at IS NULL")
    expect(captured[0]?.sql).toContain("share.expires_at > ?")
  })

  it("records download activity only while the share remains active", async () => {
    const captured: CapturedStatement[] = []
    const db = {
      prepare: (sql: string) => statement(sql, captured, { first: { id: shareId } }),
    } as unknown as D1Database

    const result = await recordPublicShareAccess({ db, shareId, access: "download", now })

    expect(result).toEqual({ tag: "recorded", shareId })
    expect(captured[0]?.sql).toContain("download_count = download_count + 1")
    expect(captured[0]?.sql).toContain("revoked_at IS NULL")
    expect(captured[0]?.sql).toContain("expires_at > ?")
  })

  it("takes one asset-scoped share offline without exposing its secret", async () => {
    const captured: CapturedStatement[] = []
    const db = {
      prepare: (sql: string) =>
        statement(sql, captured, {
          first: { ...activeRow, revoked_at: now.toISOString() },
        }),
    } as unknown as D1Database

    const result = await revokePublicShare({ db, assetId, id: shareId, now })

    expect(result).toMatchObject({ id: shareId, status: { tag: "revoked" } })
    expect(captured[0]?.sql).toContain("WHERE id = ? AND asset_id = ?")
    expect(captured[0]?.sql).not.toContain("token_hash")
  })
})
