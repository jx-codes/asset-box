import { z } from "zod"
import { AssetIdSchema } from "@/shared/domain"
import {
  WorkClaimIdSchema,
  WorkRequestIdSchema,
  WorkRequestStatusListSchema,
  type WorkRequestStatusSummary,
} from "@/shared/work-requests"
import { DatabaseFailureError } from "../errors"

const WorkRequestStatusRowSchema = z.object({
  request_id: WorkRequestIdSchema,
  parent_asset_id: AssetIdSchema.nullable(),
  title: z.string(),
  blurb: z.string(),
  created_at: z.string(),
  active_claim_id: WorkClaimIdSchema.nullable(),
  active_claim_principal_id: z.uuid().nullable(),
  active_claim_expires_at: z.string().nullable(),
  pending_failure_claim_id: WorkClaimIdSchema.nullable(),
  pending_failure_at: z.string().nullable(),
  pending_failure_reason: z.string().nullable(),
  completed_at: z.string().nullable(),
  has_submitted_unresolved: z.union([z.literal(0), z.literal(1)]),
  latest_comment_body: z.string().nullable(),
})

type WorkRequestStatusRow = z.infer<typeof WorkRequestStatusRowSchema>

function toLifecycle(
  row: WorkRequestStatusRow,
): WorkRequestStatusSummary["lifecycle"] | DatabaseFailureError {
  if (
    row.active_claim_id !== null &&
    row.active_claim_principal_id !== null &&
    row.active_claim_expires_at !== null
  ) {
    return {
      tag: "claimed",
      claimId: row.active_claim_id,
      claimedByPrincipalId: row.active_claim_principal_id,
      expiresAt: row.active_claim_expires_at,
    }
  }
  if (
    row.active_claim_id !== null ||
    row.active_claim_principal_id !== null ||
    row.active_claim_expires_at !== null
  ) {
    return new DatabaseFailureError({ operation: "work request status claim parsing" })
  }
  if (
    row.pending_failure_claim_id !== null &&
    row.pending_failure_at !== null &&
    row.pending_failure_reason !== null
  ) {
    return {
      tag: "failed",
      claimId: row.pending_failure_claim_id,
      failedAt: row.pending_failure_at,
      reason: row.pending_failure_reason,
    }
  }
  if (
    row.pending_failure_claim_id !== null ||
    row.pending_failure_at !== null ||
    row.pending_failure_reason !== null
  ) {
    return new DatabaseFailureError({ operation: "work request status failure parsing" })
  }
  if (row.has_submitted_unresolved === 1) return { tag: "submitted" }
  if (row.completed_at !== null) return { tag: "completed", completedAt: row.completed_at }
  return { tag: "draft" }
}

export async function listWorkRequestStatuses({ db, now }: { db: D1Database; now: Date }) {
  const result = await db
    .prepare(
      `SELECT
        wr.id AS request_id,
        wr.parent_asset_id,
        wr.title,
        wr.blurb,
        wr.created_at,
        active_claim.id AS active_claim_id,
        active_claim.service_token_id AS active_claim_principal_id,
        active_claim.expires_at AS active_claim_expires_at,
        pending_failure.id AS pending_failure_claim_id,
        pending_failure.failed_at AS pending_failure_at,
        pending_failure.failure_reason AS pending_failure_reason,
        (SELECT MAX(rc.resolved_at) FROM request_comments rc WHERE rc.request_id = wr.id) AS completed_at,
        EXISTS (
          SELECT 1 FROM request_comments rc
          WHERE rc.request_id = wr.id AND rc.submitted_at IS NOT NULL AND rc.resolved_at IS NULL
        ) AS has_submitted_unresolved,
        (
          SELECT rc.body FROM request_comments rc
          WHERE rc.request_id = wr.id
          ORDER BY (rc.submitted_at IS NOT NULL) DESC, rc.created_at DESC, rc.id DESC
          LIMIT 1
        ) AS latest_comment_body
      FROM work_requests wr
      LEFT JOIN work_claims active_claim ON active_claim.id = (
        SELECT wc.id FROM work_claims wc
        WHERE wc.request_id = wr.id AND wc.completed_at IS NULL AND wc.failed_at IS NULL
          AND wc.expires_at > ?
        ORDER BY wc.claimed_at DESC LIMIT 1
      )
      LEFT JOIN work_claims pending_failure ON pending_failure.id = (
        SELECT wc.id FROM work_claims wc
        WHERE wc.request_id = wr.id AND wc.failed_at IS NOT NULL AND wc.resubmitted_at IS NULL
        ORDER BY wc.failed_at DESC, wc.id DESC LIMIT 1
      )
      ORDER BY wr.created_at DESC, wr.id`,
    )
    .bind(now.toISOString())
    .all()
    .catch((cause) => new DatabaseFailureError({ operation: "work request status listing", cause }))
  if (result instanceof Error) return result
  if (!result.success) return new DatabaseFailureError({ operation: "work request status listing" })

  const parsedRows = z.array(WorkRequestStatusRowSchema).safeParse(result.results)
  if (!parsedRows.success) {
    return new DatabaseFailureError({
      operation: "work request status result parsing",
      cause: parsedRows.error,
    })
  }

  const requests: WorkRequestStatusSummary[] = []
  for (const row of parsedRows.data) {
    const lifecycle = toLifecycle(row)
    if (lifecycle instanceof Error) return lifecycle
    requests.push({
      requestId: row.request_id,
      target:
        row.parent_asset_id === null
          ? { tag: "new-asset", title: row.title, blurb: row.blurb }
          : {
              tag: "asset-edit",
              parentAssetId: row.parent_asset_id,
              title: row.title,
              blurb: row.blurb,
            },
      createdAt: row.created_at,
      lifecycle,
      latestCommentBody: row.latest_comment_body,
    })
  }

  const parsedList = WorkRequestStatusListSchema.safeParse({ requests })
  if (!parsedList.success) {
    return new DatabaseFailureError({
      operation: "work request status response parsing",
      cause: parsedList.error,
    })
  }
  return parsedList.data
}
