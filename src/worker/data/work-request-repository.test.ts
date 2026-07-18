import { describe, expect, it } from "vitest"
import type { Asset } from "@/shared/domain"
import type { WorkClaim } from "@/shared/work-requests"
import {
  claimWorkRequest,
  listAgentWork,
  getClaimContext,
  requireOwnedClaim,
  submitAllDraftComments,
} from "./work-request-repository"
import { commitWorkResult } from "./work-result-repository"

const requestId = "9a232244-4e6b-4592-ad15-6ca4e2a0e45f"
const principalId = "51013506-266b-43a5-b6bb-84e307a6a67b"
const now = new Date("2026-07-18T10:00:00.000Z")

type CapturedStatement = { sql: string; bindings: unknown[] }

function statement(
  sql: string,
  captured: CapturedStatement[],
  results: {
    first?: unknown
    all?: unknown[]
    run?: D1Result
  },
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
    run: async () =>
      results.run ?? ({ success: true, meta: { changes: 1 } } as unknown as D1Result),
  }
  return value as unknown as D1PreparedStatement
}

describe("work request repository invariants", () => {
  it("agent listing selects only submitted unresolved comments", async () => {
    const captured: CapturedStatement[] = []
    const db = {
      prepare: (sql: string) =>
        statement(sql, captured, {
          all: [
            {
              request_id: requestId,
              parent_asset_id: null,
              title: "New diagram",
              blurb: "A system overview.",
              submitted_comment_count: 1,
              oldest_submitted_at: "2026-07-18T09:00:00.000Z",
              active_claim_expires_at: null,
            },
          ],
        }),
    } as unknown as D1Database

    const result = await listAgentWork({ db, now })

    expect(result).not.toBeInstanceOf(Error)
    expect(captured[0]?.sql).toContain("rc.submitted_at IS NOT NULL")
    expect(captured[0]?.sql).toContain("rc.resolved_at IS NULL")
    expect(result).toMatchObject({ requests: [{ submittedCommentCount: 1 }] })
  })

  it("claims and snapshots comments in one D1 batch with an expiration-aware winner", async () => {
    const captured: CapturedStatement[] = []
    const batchStatements: CapturedStatement[] = []
    const claimRow = {
      id: "1fd7b329-9c89-4822-abdb-79e93cc2089f",
      request_id: requestId,
      service_token_id: principalId,
      claimed_at: now.toISOString(),
      expires_at: "2026-07-18T10:15:00.000Z",
      result_idempotency_key: "eeb34286-1d14-4c13-8c3f-271a7ad94de4",
      completed_at: null,
    }
    const db = {
      prepare: (sql: string) => {
        const results = sql.includes("FROM work_claims WHERE id")
          ? { first: claimRow }
          : sql.includes("SELECT comment_id FROM claim_comments")
            ? { all: [{ comment_id: "b809d763-f56f-4a0f-9eb9-fae9d8562f17" }] }
            : {}
        return statement(sql, captured, results)
      },
      batch: async (_statements: D1PreparedStatement[]) => {
        batchStatements.push(...captured.slice(0, 2))
        return [
          { success: true, meta: { changes: 1 } },
          { success: true, meta: { changes: 1 } },
        ] as D1Result[]
      },
    } as unknown as D1Database

    const result = await claimWorkRequest({
      db,
      requestId,
      principalId,
      leaseSeconds: 900,
      now,
    })

    expect(result).not.toBeInstanceOf(Error)
    expect(batchStatements[0]?.sql).toContain("wc.expires_at > ?")
    expect(batchStatements[0]?.sql).toContain("rc.submitted_at IS NOT NULL")
    expect(batchStatements[1]?.sql).toContain("INSERT INTO claim_comments")
    expect(batchStatements[1]?.sql).toContain("rc.resolved_at IS NULL")
    expect(result).toMatchObject({
      claimedByPrincipalId: principalId,
      commentIds: [expect.any(String)],
    })
  })

  it("uses the latest result asset as follow-up source while preserving the request target", async () => {
    const captured: CapturedStatement[] = []
    const sourceAssetId = "c".repeat(64)
    const claimRow = {
      id: "1fd7b329-9c89-4822-abdb-79e93cc2089f",
      request_id: requestId,
      service_token_id: principalId,
      claimed_at: now.toISOString(),
      expires_at: "2026-07-18T10:15:00.000Z",
      result_idempotency_key: "eeb34286-1d14-4c13-8c3f-271a7ad94de4",
      completed_at: null,
    }
    const db = {
      prepare: (sql: string) => {
        const results = (() => {
          if (sql.includes("FROM work_claims WHERE id")) return { first: claimRow }
          if (sql.includes("SELECT comment_id FROM claim_comments")) {
            return { all: [{ comment_id: "b809d763-f56f-4a0f-9eb9-fae9d8562f17" }] }
          }
          if (sql.includes("WITH request_target")) {
            return {
              first: {
                id: requestId,
                parent_asset_id: null,
                source_asset_id: sourceAssetId,
                title: "Latest result",
                blurb: "Metadata from the latest generated asset.",
              },
            }
          }
          if (sql.includes("INNER JOIN claim_comments")) {
            return {
              all: [
                {
                  id: "b809d763-f56f-4a0f-9eb9-fae9d8562f17",
                  body: "Refine the latest version.",
                  submitted_at: "2026-07-18T09:55:00.000Z",
                },
              ],
            }
          }
          return {}
        })()
        return statement(sql, captured, results)
      },
    } as unknown as D1Database

    const context = await getClaimContext({
      db,
      claimId: claimRow.id,
      principalId,
      now,
    })

    expect(context).not.toBeInstanceOf(Error)
    if (context instanceof Error) throw context
    expect(context.sourceAssetId).toBe(sourceAssetId)
    expect(context.target).toEqual({
      tag: "new-asset",
      title: "Latest result",
      blurb: "Metadata from the latest generated asset.",
    })
    const sourceQuery = captured.find((entry) => entry.sql.includes("WITH request_target"))
    expect(sourceQuery?.sql).toContain("FROM work_results result")
    expect(sourceQuery?.sql).toContain("ORDER BY result.created_at DESC")
  })

  it("rejects claim access by another service-token principal", async () => {
    const captured: CapturedStatement[] = []
    const db = {
      prepare: (sql: string) =>
        statement(sql, captured, {
          first: {
            id: "1fd7b329-9c89-4822-abdb-79e93cc2089f",
            request_id: requestId,
            service_token_id: principalId,
            claimed_at: now.toISOString(),
            expires_at: "2026-07-18T10:15:00.000Z",
            result_idempotency_key: "eeb34286-1d14-4c13-8c3f-271a7ad94de4",
            completed_at: null,
          },
        }),
    } as unknown as D1Database

    const result = await requireOwnedClaim({
      db,
      claimId: "1fd7b329-9c89-4822-abdb-79e93cc2089f",
      principalId: "77299971-f48f-43c3-b991-83534c5de4a4",
      now,
    })

    expect(result).toBeInstanceOf(Error)
    expect(result).toMatchObject({ _tag: "WorkClaimForbiddenError" })
  })

  it("rejects an expired claim so another service-token principal can reclaim the request", async () => {
    const captured: CapturedStatement[] = []
    const db = {
      prepare: (sql: string) =>
        statement(sql, captured, {
          first: {
            id: "1fd7b329-9c89-4822-abdb-79e93cc2089f",
            request_id: requestId,
            service_token_id: principalId,
            claimed_at: "2026-07-18T09:45:00.000Z",
            expires_at: now.toISOString(),
            result_idempotency_key: "eeb34286-1d14-4c13-8c3f-271a7ad94de4",
            completed_at: null,
          },
        }),
    } as unknown as D1Database

    const result = await requireOwnedClaim({
      db,
      claimId: "1fd7b329-9c89-4822-abdb-79e93cc2089f",
      principalId,
      now,
    })

    expect(result).toBeInstanceOf(Error)
    expect(result).toMatchObject({ _tag: "WorkClaimExpiredError" })
  })

  it("submits every draft with one atomic update statement", async () => {
    const captured: CapturedStatement[] = []
    const requestRow = {
      id: requestId,
      parent_asset_id: null,
      title: "New diagram",
      blurb: "A system overview.",
      created_at: "2026-07-18T09:00:00.000Z",
      active_claim_id: null,
      active_claim_principal_id: null,
      active_claim_expires_at: null,
      completed_at: null,
    }
    const db = {
      prepare: (sql: string) =>
        statement(sql, captured, {
          first: sql.includes("FROM work_requests wr") ? requestRow : null,
          all: [],
        }),
    } as unknown as D1Database

    const result = await submitAllDraftComments({ db, requestId, now })

    expect(result).not.toBeInstanceOf(Error)
    const atomicUpdate = captured.find((entry) =>
      entry.sql.includes("UPDATE request_comments SET submitted_at"),
    )
    expect(atomicUpdate?.sql).toContain("submitted_at IS NULL")
    expect(atomicUpdate?.sql).toContain("resolved_at IS NULL")
  })

  it("commits immutable lineage and resolves only the claimed comment snapshot", async () => {
    const captured: CapturedStatement[] = []
    const batched: CapturedStatement[] = []
    const assetId = "b".repeat(64)
    const parentAssetId = "a".repeat(64)
    const claim: WorkClaim = {
      id: "1fd7b329-9c89-4822-abdb-79e93cc2089f",
      requestId,
      claimedByPrincipalId: principalId,
      claimedAt: now.toISOString(),
      lifecycle: { tag: "active", expiresAt: "2026-07-18T10:15:00.000Z" },
      resultIdempotencyKey: "eeb34286-1d14-4c13-8c3f-271a7ad94de4",
      commentIds: ["b809d763-f56f-4a0f-9eb9-fae9d8562f17"],
    }
    const asset: Asset = {
      id: assetId,
      title: "Updated diagram",
      blurb: "The completed revision.",
      sizeBytes: 1024,
      createdAt: now.toISOString(),
      lifecycle: { tag: "active" },
      tags: [],
    }
    let committed = false
    const resultRow = {
      claim_id: claim.id,
      request_id: requestId,
      service_token_id: principalId,
      asset_id: assetId,
      idempotency_key: claim.resultIdempotencyKey,
      created_at: now.toISOString(),
      parent_asset_id: parentAssetId,
    }
    const assetRow = {
      id: assetId,
      title: asset.title,
      blurb: asset.blurb,
      object_key: `assets/${assetId}.html`,
      size_bytes: asset.sizeBytes,
      created_at: asset.createdAt,
      archived_at: null,
      deleted_at: null,
    }
    const db = {
      prepare: (sql: string) => {
        const first = sql.includes("WHERE wr.idempotency_key = ?")
          ? committed
            ? resultRow
            : null
          : sql.includes("FROM assets WHERE id = ? AND deleted_at IS NULL")
            ? committed
              ? assetRow
              : null
            : null
        const all = sql.includes("SELECT comment_id FROM claim_comments")
          ? [{ comment_id: claim.commentIds[0] }]
          : []
        return statement(sql, captured, { first, all })
      },
      batch: async (_statements: D1PreparedStatement[]) => {
        batched.push(...captured.slice(-5))
        committed = true
        return Array.from({ length: 5 }, () => ({
          success: true,
          meta: { changes: 1 },
        })) as D1Result[]
      },
    } as unknown as D1Database

    const result = await commitWorkResult({
      db,
      claim,
      principalId,
      idempotencyKey: claim.resultIdempotencyKey,
      asset,
      parentAssetId,
      tagSlugs: [],
      now,
    })

    expect(result).not.toBeInstanceOf(Error)
    expect(result).toMatchObject({
      lifecycle: { tag: "created" },
      lineage: {
        requestId,
        claimId: claim.id,
        parent: { tag: "asset", assetId: parentAssetId },
        resolvedCommentIds: claim.commentIds,
      },
    })
    expect(batched[0]?.sql).toContain("completed_at IS NULL AND expires_at > ?")
    expect(batched.some((entry) => entry.sql.includes("INSERT INTO asset_revisions"))).toBe(true)
    expect(batched.some((entry) => entry.sql.includes("INSERT INTO work_results"))).toBe(true)
    const resolution = batched.find((entry) =>
      entry.sql.includes("UPDATE request_comments SET resolved_at"),
    )
    expect(resolution?.sql).toContain("SELECT comment_id FROM claim_comments")
    expect(resolution?.sql).toContain("resolved_at IS NULL")
  })
})
