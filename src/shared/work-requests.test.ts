import { describe, expect, it } from "vitest"
import {
  WorkClaimFailureInputSchema,
  WorkClaimFailureSchema,
  WorkCommentSchema,
  WorkPullContextSchema,
  WorkRequestCreateInputSchema,
  WorkResultPushInputSchema,
} from "./work-requests"

const claim = {
  id: "1fd7b329-9c89-4822-abdb-79e93cc2089f",
  requestId: "9a232244-4e6b-4592-ad15-6ca4e2a0e45f",
  claimedByPrincipalId: "51013506-266b-43a5-b6bb-84e307a6a67b",
  claimedAt: "2026-07-18T10:00:00.000Z",
  lifecycle: { tag: "active", expiresAt: "2026-07-18T10:15:00.000Z" },
  resultIdempotencyKey: "eeb34286-1d14-4c13-8c3f-271a7ad94de4",
  commentIds: ["b809d763-f56f-4a0f-9eb9-fae9d8562f17"],
}

describe("work request contracts", () => {
  it("keeps comment draft, submitted, and resolved states structurally distinct", () => {
    const base = {
      id: "b809d763-f56f-4a0f-9eb9-fae9d8562f17",
      requestId: claim.requestId,
      body: "Increase the contrast.",
      createdAt: "2026-07-18T09:00:00.000Z",
    }

    expect(WorkCommentSchema.safeParse({ ...base, lifecycle: { tag: "draft" } }).success).toBe(true)
    expect(
      WorkCommentSchema.safeParse({
        ...base,
        lifecycle: { tag: "submitted", submittedAt: "2026-07-18T09:05:00.000Z" },
      }).success,
    ).toBe(true)
    expect(
      WorkCommentSchema.safeParse({
        ...base,
        lifecycle: { tag: "resolved", submittedAt: "2026-07-18T09:05:00.000Z" },
      }).success,
    ).toBe(false)
  })

  it("represents new-asset pulls without source HTML", () => {
    const context = WorkPullContextSchema.parse({
      claim,
      target: { tag: "new-asset", title: "New diagram", blurb: "A system overview." },
      comments: [
        {
          id: claim.commentIds[0],
          body: "Use a dark background.",
          submittedAt: "2026-07-18T09:05:00.000Z",
        },
      ],
      source: { tag: "none" },
    })

    expect(context.source).toEqual({ tag: "none" })
    expect("html" in context.source).toBe(false)
  })

  it("represents a reported failure as a terminal claim state with a bounded reason", () => {
    const input = WorkClaimFailureInputSchema.safeParse({ reason: "Renderer exited with code 1." })
    const failure = WorkClaimFailureSchema.safeParse({
      claimId: claim.id,
      requestId: claim.requestId,
      lifecycle: {
        tag: "failed",
        failedAt: "2026-07-18T10:05:00.000Z",
        reason: "Renderer exited with code 1.",
      },
    })

    expect(input.success).toBe(true)
    expect(failure.success).toBe(true)
    expect(WorkClaimFailureInputSchema.safeParse({ reason: "   " }).success).toBe(false)
  })

  it("requires complete push metadata and a stable idempotency key", () => {
    const valid = WorkResultPushInputSchema.safeParse({
      idempotencyKey: claim.resultIdempotencyKey,
      html: "<!doctype html><html><body>Result</body></html>",
      title: "Result",
      blurb: "Completed result.",
      tagSlugs: [],
    })
    const missingKey = WorkResultPushInputSchema.safeParse({
      html: "<!doctype html><html></html>",
      title: "Result",
      blurb: "Completed result.",
    })

    expect(valid.success).toBe(true)
    expect(missingKey.success).toBe(false)
  })

  it("makes parent presence explicit at request creation", () => {
    expect(
      WorkRequestCreateInputSchema.safeParse({
        tag: "asset-edit",
        parentAssetId: "a".repeat(64),
      }).success,
    ).toBe(true)
    expect(
      WorkRequestCreateInputSchema.safeParse({
        tag: "new-asset",
        title: "New diagram",
        blurb: "A system overview.",
      }).success,
    ).toBe(true)
    expect(WorkRequestCreateInputSchema.safeParse({ tag: "new-asset" }).success).toBe(false)
  })
})
