import * as errore from "errore"
import { z } from "zod"
import {
  AgentWorkListSchema,
  type AgentWorkSummary,
  WorkClaimFailureSchema,
  WorkClaimSchema,
  type WorkClaim,
  WorkCommentSchema,
  type WorkComment,
  WorkRequestListSchema,
  type WorkRequest,
  type WorkRequestCreateInput,
  type WorkRequestListQuery,
  WorkRequestSchema,
} from "@/shared/work-requests"
import {
  DatabaseFailureError,
  WorkAlreadyClaimedError,
  WorkClaimExpiredError,
  WorkClaimFailedError,
  WorkClaimForbiddenError,
  WorkClaimNotFoundError,
  WorkCommentNotFoundError,
  WorkNotSubmittedError,
  WorkRequestNotFoundError,
  WorkRequestStateConflictError,
  WorkResultConflictError,
} from "../errors"
import { requireAsset } from "./repository"

const WorkRequestRowSchema = z.object({
  id: z.string(),
  parent_asset_id: z.string().nullable(),
  title: z.string(),
  blurb: z.string(),
  created_at: z.string(),
  active_claim_id: z.string().nullable(),
  active_claim_principal_id: z.string().nullable(),
  active_claim_expires_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  pending_failure_claim_id: z.string().nullable(),
  pending_failure_at: z.string().nullable(),
  pending_failure_reason: z.string().nullable(),
})

const WorkCommentRowSchema = z.object({
  id: z.string(),
  request_id: z.string(),
  body: z.string(),
  created_at: z.string(),
  submitted_at: z.string().nullable(),
  resolved_at: z.string().nullable(),
  resolved_by_asset_id: z.string().nullable(),
})

const AgentWorkRowSchema = z.object({
  request_id: z.string(),
  parent_asset_id: z.string().nullable(),
  title: z.string(),
  blurb: z.string(),
  submitted_comment_count: z.number(),
  oldest_submitted_at: z.string(),
  active_claim_expires_at: z.string().nullable(),
})

const ClaimRowSchema = z.object({
  id: z.string(),
  request_id: z.string(),
  service_token_id: z.string(),
  claimed_at: z.string(),
  expires_at: z.string(),
  result_idempotency_key: z.string(),
  completed_at: z.string().nullable(),
  failed_at: z.string().nullable(),
  failure_reason: z.string().nullable(),
  resubmitted_at: z.string().nullable(),
})

const ClaimCommentRowSchema = z.object({ comment_id: z.string() })

const SubmittedCommentRowSchema = z.object({
  id: z.string(),
  body: z.string(),
  submitted_at: z.string(),
})

const WorkTargetRowSchema = z.object({
  id: z.string(),
  parent_asset_id: z.string().nullable(),
  source_asset_id: z.string().nullable(),
  title: z.string(),
  blurb: z.string(),
})

type Lookup<T> = { tag: "found"; value: T } | { tag: "missing" }

async function readRows<T>({
  statement,
  schema,
  operation,
}: {
  statement: D1PreparedStatement
  schema: z.ZodType<T>
  operation: string
}) {
  const result = await statement
    .all()
    .catch((cause) => new DatabaseFailureError({ operation, cause }))
  if (result instanceof Error) return result
  if (!result.success) return new DatabaseFailureError({ operation })

  return errore.try({
    try: () => z.array(schema).parse(result.results),
    catch: (cause) => new DatabaseFailureError({ operation: `${operation} result parsing`, cause }),
  })
}

async function readFirst<T>({
  statement,
  schema,
  operation,
}: {
  statement: D1PreparedStatement
  schema: z.ZodType<T>
  operation: string
}): Promise<DatabaseFailureError | Lookup<T>> {
  const result = await statement
    .first()
    .catch((cause) => new DatabaseFailureError({ operation, cause }))
  if (result instanceof Error) return result
  if (result === null) return { tag: "missing" }

  const parsed = errore.try({
    try: () => schema.parse(result),
    catch: (cause) => new DatabaseFailureError({ operation: `${operation} result parsing`, cause }),
  })
  if (parsed instanceof Error) return parsed
  return { tag: "found", value: parsed }
}

function toComment(row: z.infer<typeof WorkCommentRowSchema>): WorkComment {
  const lifecycle: WorkComment["lifecycle"] = (() => {
    if (
      row.submitted_at !== null &&
      row.resolved_at !== null &&
      row.resolved_by_asset_id !== null
    ) {
      return {
        tag: "resolved",
        submittedAt: row.submitted_at,
        resolvedAt: row.resolved_at,
        resultAssetId: row.resolved_by_asset_id,
      }
    }
    if (row.submitted_at !== null) return { tag: "submitted", submittedAt: row.submitted_at }
    return { tag: "draft" }
  })()

  return WorkCommentSchema.parse({
    id: row.id,
    requestId: row.request_id,
    body: row.body,
    createdAt: row.created_at,
    lifecycle,
  })
}

function toRequestLifecycle(
  row: z.infer<typeof WorkRequestRowSchema>,
): DatabaseFailureError | WorkRequest["lifecycle"] {
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
    return new DatabaseFailureError({ operation: "work request active claim parsing" })
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
    return new DatabaseFailureError({ operation: "work request failure parsing" })
  }
  if (row.completed_at !== null) return { tag: "completed", completedAt: row.completed_at }
  return { tag: "draft" }
}

async function loadRequest({
  db,
  row,
}: {
  db: D1Database
  row: z.infer<typeof WorkRequestRowSchema>
}) {
  const comments = await readRows({
    statement: db
      .prepare(
        `SELECT id, request_id, body, created_at, submitted_at, resolved_at, resolved_by_asset_id
         FROM request_comments WHERE request_id = ? ORDER BY created_at, id`,
      )
      .bind(row.id),
    schema: WorkCommentRowSchema,
    operation: "work request comment listing",
  })
  if (comments instanceof Error) return comments

  const lifecycle = (() => {
    const base = toRequestLifecycle(row)
    if (base instanceof Error) return base
    if (base.tag === "claimed" || base.tag === "failed") return base
    if (comments.some((comment) => comment.submitted_at !== null && comment.resolved_at === null)) {
      return { tag: "submitted" as const }
    }
    return base
  })()
  if (lifecycle instanceof Error) return lifecycle

  const target = await (async () => {
    if (row.parent_asset_id === null) {
      return { tag: "new-asset" as const, title: row.title, blurb: row.blurb }
    }
    const asset = await requireAsset({ db, id: row.parent_asset_id })
    if (asset instanceof Error) return asset
    return { tag: "asset-edit" as const, asset }
  })()
  if (target instanceof Error) return target

  return WorkRequestSchema.parse({
    id: row.id,
    target,
    createdAt: row.created_at,
    lifecycle,
    comments: comments.map(toComment),
  })
}

function requestSelectSql(whereClause: string) {
  return `SELECT
    wr.id,
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
    (SELECT MAX(rc.resolved_at) FROM request_comments rc WHERE rc.request_id = wr.id) AS completed_at
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
  WHERE ${whereClause}
  ORDER BY wr.created_at DESC`
}

export async function listWorkRequests({
  db,
  query,
  now,
}: {
  db: D1Database
  query: WorkRequestListQuery
  now: Date
}) {
  const statement =
    query.tag === "asset-edit"
      ? db
          .prepare(requestSelectSql("wr.parent_asset_id = ?"))
          .bind(now.toISOString(), query.parentAssetId)
      : db.prepare(requestSelectSql("wr.parent_asset_id IS NULL")).bind(now.toISOString())
  const rows = await readRows({
    statement,
    schema: WorkRequestRowSchema,
    operation: "work request listing",
  })
  if (rows instanceof Error) return rows

  const requests = await Promise.all(rows.map((row) => loadRequest({ db, row })))
  const failure = requests.find((request) => request instanceof Error)
  if (failure instanceof Error) return failure
  return WorkRequestListSchema.parse({ requests })
}

export async function requireWorkRequest({
  db,
  id,
  now,
}: {
  db: D1Database
  id: string
  now: Date
}) {
  const row = await readFirst({
    statement: db.prepare(requestSelectSql("wr.id = ?")).bind(now.toISOString(), id),
    schema: WorkRequestRowSchema,
    operation: "work request lookup",
  })
  if (row instanceof Error) return row
  if (row.tag === "missing") return new WorkRequestNotFoundError({ id })
  return loadRequest({ db, row: row.value })
}

export async function createWorkRequest({
  db,
  input,
  now,
}: {
  db: D1Database
  input: WorkRequestCreateInput
  now: Date
}) {
  const creation = await (async () => {
    if (input.tag === "new-asset") {
      return {
        tag: "new-asset" as const,
        parentAssetId: null,
        title: input.title,
        blurb: input.blurb,
        initialCommentId: crypto.randomUUID(),
      }
    }
    const asset = await requireAsset({ db, id: input.parentAssetId })
    if (asset instanceof Error) return asset
    return {
      tag: "asset-edit" as const,
      parentAssetId: asset.id,
      title: asset.title,
      blurb: asset.blurb,
    }
  })()
  if (creation instanceof Error) return creation

  const id = crypto.randomUUID()
  const createdAt = now.toISOString()
  const requestInsert = db
    .prepare(
      `INSERT INTO work_requests (id, parent_asset_id, title, blurb, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, creation.parentAssetId, creation.title, creation.blurb, createdAt)

  if (creation.tag === "new-asset") {
    const results = await db
      .batch([
        requestInsert,
        db
          .prepare(
            `INSERT INTO request_comments
              (id, request_id, body, created_at, submitted_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(creation.initialCommentId, id, creation.blurb, createdAt, createdAt),
      ])
      .catch(
        (cause) => new DatabaseFailureError({ operation: "new asset request creation", cause }),
      )
    if (results instanceof Error) return results
    if (results.some((result) => !result.success)) {
      return new DatabaseFailureError({ operation: "new asset request creation" })
    }
    return requireWorkRequest({ db, id, now })
  }

  const result = await requestInsert
    .run()
    .catch((cause) => new DatabaseFailureError({ operation: "asset edit request creation", cause }))
  if (result instanceof Error) return result
  if (!result.success) return new DatabaseFailureError({ operation: "asset edit request creation" })
  return requireWorkRequest({ db, id, now })
}

export async function addDraftComment({
  db,
  requestId,
  body,
  now,
}: {
  db: D1Database
  requestId: string
  body: string
  now: Date
}) {
  const id = crypto.randomUUID()
  const row = await readFirst({
    statement: db
      .prepare(
        `INSERT INTO request_comments (id, request_id, body, created_at)
         SELECT ?, id, ?, ? FROM work_requests WHERE id = ?
         RETURNING id, request_id, body, created_at, submitted_at, resolved_at, resolved_by_asset_id`,
      )
      .bind(id, body, now.toISOString(), requestId),
    schema: WorkCommentRowSchema,
    operation: "draft comment creation",
  })
  if (row instanceof Error) return row
  if (row.tag === "missing") return new WorkRequestNotFoundError({ id: requestId })
  return toComment(row.value)
}

export async function submitComment({
  db,
  requestId,
  commentId,
  now,
}: {
  db: D1Database
  requestId: string
  commentId: string
  now: Date
}) {
  const row = await readFirst({
    statement: db
      .prepare(
        `UPDATE request_comments SET submitted_at = COALESCE(submitted_at, ?)
         WHERE id = ? AND request_id = ? AND resolved_at IS NULL
         RETURNING id, request_id, body, created_at, submitted_at, resolved_at, resolved_by_asset_id`,
      )
      .bind(now.toISOString(), commentId, requestId),
    schema: WorkCommentRowSchema,
    operation: "comment submission",
  })
  if (row instanceof Error) return row
  if (row.tag === "missing") return new WorkCommentNotFoundError({ id: commentId, requestId })
  return toComment(row.value)
}

export async function submitAllDraftComments({
  db,
  requestId,
  now,
}: {
  db: D1Database
  requestId: string
  now: Date
}) {
  const request = await requireWorkRequest({ db, id: requestId, now })
  if (request instanceof Error) return request

  const result = await db
    .prepare(
      `UPDATE request_comments SET submitted_at = ?
       WHERE request_id = ? AND submitted_at IS NULL AND resolved_at IS NULL`,
    )
    .bind(now.toISOString(), requestId)
    .run()
    .catch((cause) => new DatabaseFailureError({ operation: "atomic comment submission", cause }))
  if (result instanceof Error) return result
  if (!result.success) return new DatabaseFailureError({ operation: "atomic comment submission" })
  return requireWorkRequest({ db, id: requestId, now })
}

export async function listAgentWork({ db, now }: { db: D1Database; now: Date }) {
  const rows = await readRows({
    statement: db
      .prepare(
        `SELECT
          wr.id AS request_id,
          wr.parent_asset_id,
          wr.title,
          wr.blurb,
          COUNT(rc.id) AS submitted_comment_count,
          MIN(rc.submitted_at) AS oldest_submitted_at,
          active_claim.expires_at AS active_claim_expires_at
        FROM work_requests wr
        INNER JOIN request_comments rc
          ON rc.request_id = wr.id AND rc.submitted_at IS NOT NULL AND rc.resolved_at IS NULL
        LEFT JOIN work_claims active_claim ON active_claim.id = (
          SELECT wc.id FROM work_claims wc
          WHERE wc.request_id = wr.id AND wc.completed_at IS NULL AND wc.failed_at IS NULL
            AND wc.expires_at > ?
          ORDER BY wc.claimed_at DESC LIMIT 1
        )
        WHERE NOT EXISTS (
          SELECT 1 FROM work_claims failed_claim
          WHERE failed_claim.request_id = wr.id AND failed_claim.failed_at IS NOT NULL
            AND failed_claim.resubmitted_at IS NULL
        )
        GROUP BY wr.id, wr.parent_asset_id, wr.title, wr.blurb, active_claim.expires_at
        ORDER BY oldest_submitted_at, wr.id`,
      )
      .bind(now.toISOString()),
    schema: AgentWorkRowSchema,
    operation: "agent work listing",
  })
  if (rows instanceof Error) return rows

  const requests: AgentWorkSummary[] = rows.map((row) => ({
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
    submittedCommentCount: row.submitted_comment_count,
    oldestSubmittedAt: row.oldest_submitted_at,
    availability:
      row.active_claim_expires_at === null
        ? { tag: "available" }
        : { tag: "claimed", expiresAt: row.active_claim_expires_at },
  }))
  return AgentWorkListSchema.parse({ requests })
}

async function findClaim({ db, id }: { db: D1Database; id: string }) {
  return readFirst({
    statement: db
      .prepare(
        `SELECT id, request_id, service_token_id, claimed_at, expires_at,
          result_idempotency_key, completed_at, failed_at, failure_reason, resubmitted_at
         FROM work_claims WHERE id = ?`,
      )
      .bind(id),
    schema: ClaimRowSchema,
    operation: "work claim lookup",
  })
}

async function claimCommentIds({ db, claimId }: { db: D1Database; claimId: string }) {
  const rows = await readRows({
    statement: db
      .prepare("SELECT comment_id FROM claim_comments WHERE claim_id = ? ORDER BY comment_id")
      .bind(claimId),
    schema: ClaimCommentRowSchema,
    operation: "claim comment listing",
  })
  if (rows instanceof Error) return rows
  return rows.map((row) => row.comment_id)
}

function toClaim({
  row,
  commentIds,
}: {
  row: z.infer<typeof ClaimRowSchema>
  commentIds: string[]
}): WorkClaim {
  return WorkClaimSchema.parse({
    id: row.id,
    requestId: row.request_id,
    claimedByPrincipalId: row.service_token_id,
    claimedAt: row.claimed_at,
    lifecycle: { tag: "active", expiresAt: row.expires_at },
    resultIdempotencyKey: row.result_idempotency_key,
    commentIds,
  })
}

export async function claimWorkRequest({
  db,
  requestId,
  principalId,
  leaseSeconds,
  now,
}: {
  db: D1Database
  requestId: string
  principalId: string
  leaseSeconds: number
  now: Date
}) {
  const id = crypto.randomUUID()
  const idempotencyKey = crypto.randomUUID()
  const claimedAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString()
  const results = await db
    .batch([
      db
        .prepare(
          `INSERT INTO work_claims
            (id, request_id, service_token_id, claimed_at, expires_at, result_idempotency_key)
           SELECT ?, wr.id, ?, ?, ?, ?
           FROM work_requests wr
           WHERE wr.id = ?
             AND EXISTS (
               SELECT 1 FROM request_comments rc
               WHERE rc.request_id = wr.id AND rc.submitted_at IS NOT NULL AND rc.resolved_at IS NULL
             )
             AND NOT EXISTS (
               SELECT 1 FROM work_claims wc
               WHERE wc.request_id = wr.id AND wc.completed_at IS NULL AND wc.failed_at IS NULL
                 AND wc.expires_at > ?
             )
             AND NOT EXISTS (
               SELECT 1 FROM work_claims failed_claim
               WHERE failed_claim.request_id = wr.id AND failed_claim.failed_at IS NOT NULL
                 AND failed_claim.resubmitted_at IS NULL
             )`,
        )
        .bind(id, principalId, claimedAt, expiresAt, idempotencyKey, requestId, claimedAt),
      db
        .prepare(
          `INSERT INTO claim_comments (claim_id, comment_id)
           SELECT ?, rc.id FROM request_comments rc
           WHERE rc.request_id = ? AND rc.submitted_at IS NOT NULL AND rc.resolved_at IS NULL
             AND EXISTS (SELECT 1 FROM work_claims WHERE id = ?)`,
        )
        .bind(id, requestId, id),
    ])
    .catch((cause) => new DatabaseFailureError({ operation: "atomic work claim", cause }))
  if (results instanceof Error) return results
  if (results.some((result) => !result.success)) {
    return new DatabaseFailureError({ operation: "atomic work claim" })
  }
  if ((results[0]?.meta.changes ?? 0) === 0) {
    const request = await requireWorkRequest({ db, id: requestId, now })
    if (request instanceof Error) return request
    if (request.lifecycle.tag === "claimed") return new WorkAlreadyClaimedError({ id: requestId })
    if (request.lifecycle.tag === "failed") {
      return new WorkRequestStateConflictError({
        id: requestId,
        reason: "must be resubmitted after its reported failure",
      })
    }
    return new WorkNotSubmittedError({ id: requestId })
  }

  const row = await findClaim({ db, id })
  if (row instanceof Error) return row
  if (row.tag === "missing") return new DatabaseFailureError({ operation: "work claim readback" })
  const commentIds = await claimCommentIds({ db, claimId: id })
  if (commentIds instanceof Error) return commentIds
  return toClaim({ row: row.value, commentIds })
}

function toClaimFailure(row: z.infer<typeof ClaimRowSchema>) {
  if (row.failed_at === null || row.failure_reason === null) {
    return new DatabaseFailureError({ operation: "work claim failure parsing" })
  }

  return errore.try({
    try: () =>
      WorkClaimFailureSchema.parse({
        claimId: row.id,
        requestId: row.request_id,
        lifecycle: { tag: "failed", failedAt: row.failed_at, reason: row.failure_reason },
      }),
    catch: (cause) => new DatabaseFailureError({ operation: "work claim failure parsing", cause }),
  })
}

export async function failOwnedClaim({
  db,
  claimId,
  principalId,
  reason,
  now,
}: {
  db: D1Database
  claimId: string
  principalId: string
  reason: string
  now: Date
}) {
  const failedAt = now.toISOString()
  const updated = await readFirst({
    statement: db
      .prepare(
        `UPDATE work_claims SET failed_at = ?, failure_reason = ?
         WHERE id = ? AND service_token_id = ? AND completed_at IS NULL
           AND failed_at IS NULL AND expires_at > ?
         RETURNING id, request_id, service_token_id, claimed_at, expires_at,
           result_idempotency_key, completed_at, failed_at, failure_reason, resubmitted_at`,
      )
      .bind(failedAt, reason, claimId, principalId, failedAt),
    schema: ClaimRowSchema,
    operation: "work claim failure report",
  })
  if (updated instanceof Error) return updated
  if (updated.tag === "found") return toClaimFailure(updated.value)

  const existing = await findClaim({ db, id: claimId })
  if (existing instanceof Error) return existing
  if (existing.tag === "missing") return new WorkClaimNotFoundError({ id: claimId })
  if (existing.value.service_token_id !== principalId) {
    return new WorkClaimForbiddenError({ id: claimId })
  }
  if (existing.value.failed_at !== null || existing.value.failure_reason !== null) {
    return toClaimFailure(existing.value)
  }
  if (existing.value.completed_at !== null) {
    return new WorkResultConflictError({ reason: `Work claim ${claimId} already has a result` })
  }
  if (existing.value.expires_at <= failedAt) {
    return new WorkClaimExpiredError({ id: claimId, expiresAt: existing.value.expires_at })
  }
  return new DatabaseFailureError({ operation: "work claim failure transition" })
}

export async function resubmitFailedWorkRequest({
  db,
  requestId,
  now,
}: {
  db: D1Database
  requestId: string
  now: Date
}) {
  const resubmittedAt = now.toISOString()
  const result = await db
    .prepare(
      `UPDATE work_claims SET resubmitted_at = ?
       WHERE id = (
         SELECT id FROM work_claims
         WHERE request_id = ? AND failed_at IS NOT NULL AND resubmitted_at IS NULL
         ORDER BY failed_at DESC, id DESC LIMIT 1
       ) AND request_id = ? AND completed_at IS NULL
         AND failed_at IS NOT NULL AND resubmitted_at IS NULL`,
    )
    .bind(resubmittedAt, requestId, requestId)
    .run()
    .catch((cause) => new DatabaseFailureError({ operation: "work request resubmission", cause }))
  if (result instanceof Error) return result
  if (!result.success) return new DatabaseFailureError({ operation: "work request resubmission" })
  if ((result.meta.changes ?? 0) > 0) return requireWorkRequest({ db, id: requestId, now })

  const request = await requireWorkRequest({ db, id: requestId, now })
  if (request instanceof Error) return request
  if (request.lifecycle.tag === "failed") {
    return new DatabaseFailureError({ operation: "work request resubmission transition" })
  }
  return new WorkRequestStateConflictError({
    id: requestId,
    reason: "is not awaiting resubmission",
  })
}

export async function requireOwnedClaim({
  db,
  claimId,
  principalId,
  now,
  allowCompleted = false,
}: {
  db: D1Database
  claimId: string
  principalId: string
  now: Date
  allowCompleted?: boolean
}) {
  const row = await findClaim({ db, id: claimId })
  if (row instanceof Error) return row
  if (row.tag === "missing") return new WorkClaimNotFoundError({ id: claimId })
  if (row.value.service_token_id !== principalId) {
    return new WorkClaimForbiddenError({ id: claimId })
  }
  if (row.value.failed_at !== null || row.value.failure_reason !== null) {
    if (row.value.failed_at !== null && row.value.failure_reason !== null) {
      return new WorkClaimFailedError({ id: claimId, failedAt: row.value.failed_at })
    }
    return new DatabaseFailureError({ operation: "work claim failure parsing" })
  }
  if (!allowCompleted && row.value.completed_at !== null) {
    return new WorkResultConflictError({ reason: `Work claim ${claimId} already has a result` })
  }
  if (!allowCompleted && row.value.expires_at <= now.toISOString()) {
    return new WorkClaimExpiredError({ id: claimId, expiresAt: row.value.expires_at })
  }
  const commentIds = await claimCommentIds({ db, claimId })
  if (commentIds instanceof Error) return commentIds
  return toClaim({ row: row.value, commentIds })
}

export async function getClaimContext({
  db,
  claimId,
  principalId,
  now,
}: {
  db: D1Database
  claimId: string
  principalId: string
  now: Date
}) {
  const claim = await requireOwnedClaim({ db, claimId, principalId, now })
  if (claim instanceof Error) return claim

  const [target, comments] = await Promise.all([
    readFirst({
      statement: db
        .prepare(
          `WITH request_target AS (
             SELECT
               wr.id,
               wr.parent_asset_id,
               wr.title AS request_title,
               wr.blurb AS request_blurb,
               COALESCE(
                 (
                   SELECT result.asset_id
                   FROM work_results result
                   WHERE result.request_id = wr.id
                   ORDER BY result.created_at DESC, result.asset_id DESC
                   LIMIT 1
                 ),
                 wr.parent_asset_id
               ) AS source_asset_id
             FROM work_requests wr
             WHERE wr.id = ?
           )
           SELECT
             target.id,
             target.parent_asset_id,
             target.source_asset_id,
             COALESCE(source.title, target.request_title) AS title,
             COALESCE(source.blurb, target.request_blurb) AS blurb
           FROM request_target target
           LEFT JOIN assets source ON source.id = target.source_asset_id`,
        )
        .bind(claim.requestId),
      schema: WorkTargetRowSchema,
      operation: "claimed work target lookup",
    }),
    readRows({
      statement: db
        .prepare(
          `SELECT rc.id, rc.body, rc.submitted_at
           FROM request_comments rc
           INNER JOIN claim_comments cc ON cc.comment_id = rc.id
           WHERE cc.claim_id = ? AND rc.submitted_at IS NOT NULL
           ORDER BY rc.submitted_at, rc.id`,
        )
        .bind(claimId),
      schema: SubmittedCommentRowSchema,
      operation: "claimed work comment listing",
    }),
  ])
  if (target instanceof Error) return target
  if (target.tag === "missing") return new WorkRequestNotFoundError({ id: claim.requestId })
  if (comments instanceof Error) return comments

  return {
    claim,
    sourceAssetId: target.value.source_asset_id,
    target:
      target.value.parent_asset_id === null
        ? {
            tag: "new-asset" as const,
            title: target.value.title,
            blurb: target.value.blurb,
          }
        : {
            tag: "asset-edit" as const,
            parentAssetId: target.value.parent_asset_id,
            title: target.value.title,
            blurb: target.value.blurb,
          },
    comments: comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      submittedAt: comment.submitted_at,
    })),
  }
}
