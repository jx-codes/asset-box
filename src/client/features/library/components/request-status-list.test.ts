import { describe, expect, it } from "vitest"
import type { WorkRequestStatusSummary } from "@/shared/work-requests"
import { groupWorkRequestStatuses } from "./request-status-list"

const lifecycle = { tag: "submitted" as const }
const createdAt = "2026-07-18T10:00:00.000Z"

function status(
  requestId: string,
  target: WorkRequestStatusSummary["target"],
): WorkRequestStatusSummary {
  return { requestId, target, createdAt, lifecycle, latestCommentBody: "Requested work" }
}

describe("request status grouping", () => {
  it("keeps fresh requests separate and groups edits beneath their asset", () => {
    const assetId = "a".repeat(64)
    const groups = groupWorkRequestStatuses([
      status("9a232244-4e6b-4592-ad15-6ca4e2a0e45f", {
        tag: "new-asset",
        title: "Fresh asset",
        blurb: "Create it.",
      }),
      status("d4d78958-f273-4606-b545-fc261549b461", {
        tag: "asset-edit",
        parentAssetId: assetId,
        title: "Existing asset",
        blurb: "Current asset.",
      }),
      status("d98ed21f-0158-4ace-a29a-50c75a86c86b", {
        tag: "asset-edit",
        parentAssetId: assetId,
        title: "Existing asset",
        blurb: "Current asset.",
      }),
    ])

    expect(groups.newAssetRequests).toHaveLength(1)
    expect(groups.assetGroups).toEqual([
      expect.objectContaining({
        assetId,
        title: "Existing asset",
        requests: [
          expect.objectContaining({ requestId: "d4d78958-f273-4606-b545-fc261549b461" }),
          expect.objectContaining({ requestId: "d98ed21f-0158-4ace-a29a-50c75a86c86b" }),
        ],
      }),
    ])
  })
})
