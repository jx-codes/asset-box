import { describe, expect, it } from "vitest"
import { listWorkRequestStatuses } from "./work-request-status-repository"

const now = new Date("2026-07-18T10:00:00.000Z")

function databaseWithRows(rows: unknown[]) {
  const statement = {
    bind: () => statement,
    all: async () => ({ success: true, results: rows }),
  }
  return {
    prepare: () => statement,
  } as unknown as D1Database
}

describe("work request status repository", () => {
  it("returns fresh requests and asset edits through one lifecycle projection", async () => {
    const result = await listWorkRequestStatuses({
      db: databaseWithRows([
        {
          request_id: "9a232244-4e6b-4592-ad15-6ca4e2a0e45f",
          parent_asset_id: null,
          title: "New diagram",
          blurb: "Show the request lifecycle.",
          created_at: "2026-07-18T09:00:00.000Z",
          active_claim_id: null,
          active_claim_principal_id: null,
          active_claim_expires_at: null,
          completed_at: null,
          pending_failure_claim_id: null,
          pending_failure_at: null,
          pending_failure_reason: null,
          has_submitted_unresolved: 1,
          latest_comment_body: "Show the request lifecycle.",
        },
        {
          request_id: "d4d78958-f273-4606-b545-fc261549b461",
          parent_asset_id: "a".repeat(64),
          title: "Existing diagram",
          blurb: "Current architecture diagram.",
          created_at: "2026-07-18T08:00:00.000Z",
          active_claim_id: "1fd7b329-9c89-4822-abdb-79e93cc2089f",
          active_claim_principal_id: "51013506-266b-43a5-b6bb-84e307a6a67b",
          active_claim_expires_at: "2026-07-18T10:15:00.000Z",
          completed_at: null,
          pending_failure_claim_id: null,
          pending_failure_at: null,
          pending_failure_reason: null,
          has_submitted_unresolved: 1,
          latest_comment_body: "Increase the heading contrast.",
        },
      ]),
      now,
    })

    expect(result).not.toBeInstanceOf(Error)
    expect(result).toMatchObject({
      requests: [
        {
          target: { tag: "new-asset", title: "New diagram" },
          lifecycle: { tag: "submitted" },
        },
        {
          target: { tag: "asset-edit", parentAssetId: "a".repeat(64) },
          lifecycle: { tag: "claimed", expiresAt: "2026-07-18T10:15:00.000Z" },
          latestCommentBody: "Increase the heading contrast.",
        },
      ],
    })
  })

  it("shows a failed request until the user resubmits it", async () => {
    const result = await listWorkRequestStatuses({
      db: databaseWithRows([
        {
          request_id: "9a232244-4e6b-4592-ad15-6ca4e2a0e45f",
          parent_asset_id: null,
          title: "New diagram",
          blurb: "Show the request lifecycle.",
          created_at: "2026-07-18T09:00:00.000Z",
          active_claim_id: null,
          active_claim_principal_id: null,
          active_claim_expires_at: null,
          pending_failure_claim_id: "1fd7b329-9c89-4822-abdb-79e93cc2089f",
          pending_failure_at: "2026-07-18T10:05:00.000Z",
          pending_failure_reason: "Renderer exited with code 1.",
          completed_at: null,
          has_submitted_unresolved: 1,
          latest_comment_body: "Show the request lifecycle.",
        },
      ]),
      now,
    })

    expect(result).toMatchObject({
      requests: [
        {
          lifecycle: {
            tag: "failed",
            claimId: "1fd7b329-9c89-4822-abdb-79e93cc2089f",
            reason: "Renderer exited with code 1.",
          },
        },
      ],
    })
  })

  it("rejects a partially populated active claim", async () => {
    const result = await listWorkRequestStatuses({
      db: databaseWithRows([
        {
          request_id: "9a232244-4e6b-4592-ad15-6ca4e2a0e45f",
          parent_asset_id: null,
          title: "New diagram",
          blurb: "Show the request lifecycle.",
          created_at: "2026-07-18T09:00:00.000Z",
          active_claim_id: "1fd7b329-9c89-4822-abdb-79e93cc2089f",
          active_claim_principal_id: null,
          active_claim_expires_at: null,
          completed_at: null,
          pending_failure_claim_id: null,
          pending_failure_at: null,
          pending_failure_reason: null,
          has_submitted_unresolved: 1,
          latest_comment_body: "Show the request lifecycle.",
        },
      ]),
      now,
    })

    expect(result).toBeInstanceOf(Error)
    expect(result).toMatchObject({ _tag: "DatabaseFailureError" })
  })
})
