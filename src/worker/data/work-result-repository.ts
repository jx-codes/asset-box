import * as errore from "errore"
import { z } from "zod"
import { type Asset, AssetSchema } from "@/shared/domain"
import { type WorkClaim, type WorkResult, WorkResultSchema } from "@/shared/work-requests"
import { DatabaseFailureError, WorkResultConflictError } from "../errors"
import { findAsset, requireAsset, requireTagsBySlugs } from "./repository"
import { requireOwnedClaim } from "./work-request-repository"

const ClaimCommentRowSchema = z.object({ comment_id: z.string() })

const WorkResultRowSchema = z.object({
  claim_id: z.string(),
  request_id: z.string(),
  service_token_id: z.string(),
  asset_id: z.string(),
  idempotency_key: z.string(),
  created_at: z.string(),
  parent_asset_id: z.string().nullable(),
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

async function claimCommentIds({ db, claimId }: { db: D1Database; claimId: string }) {
  const rows = await readRows({
    statement: db
      .prepare("SELECT comment_id FROM claim_comments WHERE claim_id = ? ORDER BY comment_id")
      .bind(claimId),
    schema: ClaimCommentRowSchema,
    operation: "result claim comment listing",
  })
  if (rows instanceof Error) return rows
  return rows.map((row) => row.comment_id)
}

async function findWorkResultByIdempotency({
  db,
  idempotencyKey,
}: {
  db: D1Database
  idempotencyKey: string
}) {
  return readFirst({
    statement: db
      .prepare(
        `SELECT wr.claim_id, wr.request_id, wr.service_token_id, wr.asset_id,
          wr.idempotency_key, wr.created_at, ar.parent_asset_id
         FROM work_results wr
         INNER JOIN asset_revisions ar ON ar.asset_id = wr.asset_id
         WHERE wr.idempotency_key = ?`,
      )
      .bind(idempotencyKey),
    schema: WorkResultRowSchema,
    operation: "work result idempotency lookup",
  })
}

async function loadWorkResult({
  db,
  row,
  lifecycleTag,
}: {
  db: D1Database
  row: z.infer<typeof WorkResultRowSchema>
  lifecycleTag: WorkResult["lifecycle"]["tag"]
}) {
  const [asset, commentIds] = await Promise.all([
    requireAsset({ db, id: row.asset_id }),
    claimCommentIds({ db, claimId: row.claim_id }),
  ])
  if (asset instanceof Error) return asset
  if (commentIds instanceof Error) return commentIds
  return WorkResultSchema.parse({
    lifecycle: { tag: lifecycleTag },
    asset,
    lineage: {
      requestId: row.request_id,
      claimId: row.claim_id,
      parent:
        row.parent_asset_id === null
          ? { tag: "none" }
          : { tag: "asset", assetId: row.parent_asset_id },
      resolvedCommentIds: commentIds,
    },
    createdAt: row.created_at,
  })
}

export async function findIdempotentWorkResult({
  db,
  claimId,
  principalId,
  idempotencyKey,
}: {
  db: D1Database
  claimId: string
  principalId: string
  idempotencyKey: string
}) {
  const row = await findWorkResultByIdempotency({ db, idempotencyKey })
  if (row instanceof Error) return row
  if (row.tag === "missing") return row
  if (row.value.claim_id !== claimId || row.value.service_token_id !== principalId) {
    return new WorkResultConflictError({ reason: "The idempotency key belongs to another result" })
  }
  const result = await loadWorkResult({ db, row: row.value, lifecycleTag: "replayed" })
  if (result instanceof Error) return result
  return { tag: "found" as const, value: result }
}

export async function commitWorkResult({
  db,
  claim,
  principalId,
  idempotencyKey,
  asset,
  parentAssetId,
  tagSlugs,
  now,
}: {
  db: D1Database
  claim: WorkClaim
  principalId: string
  idempotencyKey: string
  asset: Asset
  parentAssetId: string | null
  tagSlugs: string[]
  now: Date
}) {
  if (claim.resultIdempotencyKey !== idempotencyKey) {
    return new WorkResultConflictError({
      reason: "The result idempotency key does not match the claimed work snapshot",
    })
  }

  const replay = await findIdempotentWorkResult({
    db,
    claimId: claim.id,
    principalId,
    idempotencyKey,
  })
  if (replay instanceof Error) return replay
  if (replay.tag === "found") return replay.value

  const existingAsset = await findAsset({ db, id: asset.id })
  if (existingAsset instanceof Error) return existingAsset
  if (existingAsset.tag === "found") {
    return new WorkResultConflictError({
      reason: "Result HTML already exists as an asset; a revision must contain new content",
    })
  }

  const tags = await requireTagsBySlugs({ db, slugs: Array.from(new Set(tagSlugs)) })
  if (tags instanceof Error) return tags
  const createdAt = now.toISOString()
  const storedAsset = AssetSchema.parse({ ...asset, tags })
  const statements = [
    db
      .prepare(
        `UPDATE work_claims SET completed_at = ?
         WHERE id = ? AND service_token_id = ? AND completed_at IS NULL AND expires_at > ?`,
      )
      .bind(createdAt, claim.id, principalId, createdAt),
    db
      .prepare(
        `INSERT INTO assets (id, title, blurb, object_key, size_bytes, created_at)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM work_claims
           WHERE id = ? AND service_token_id = ? AND completed_at = ?
         )`,
      )
      .bind(
        storedAsset.id,
        storedAsset.title,
        storedAsset.blurb,
        `assets/${storedAsset.id}.html`,
        storedAsset.sizeBytes,
        storedAsset.createdAt,
        claim.id,
        principalId,
        createdAt,
      ),
    ...tags.map((tag) =>
      db
        .prepare(
          `INSERT INTO asset_tags (asset_id, tag_id)
           SELECT ?, ?
           WHERE EXISTS (
             SELECT 1 FROM work_claims
             WHERE id = ? AND service_token_id = ? AND completed_at = ?
           )`,
        )
        .bind(storedAsset.id, tag.id, claim.id, principalId, createdAt),
    ),
    db
      .prepare(
        `INSERT INTO asset_revisions
          (asset_id, parent_asset_id, request_id, claim_id, created_at)
         SELECT ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM work_claims
           WHERE id = ? AND service_token_id = ? AND completed_at = ?
         )`,
      )
      .bind(
        storedAsset.id,
        parentAssetId,
        claim.requestId,
        claim.id,
        createdAt,
        claim.id,
        principalId,
        createdAt,
      ),
    db
      .prepare(
        `INSERT INTO work_results
          (claim_id, request_id, service_token_id, asset_id, idempotency_key, created_at)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM work_claims
           WHERE id = ? AND service_token_id = ? AND completed_at = ?
         )`,
      )
      .bind(
        claim.id,
        claim.requestId,
        principalId,
        storedAsset.id,
        idempotencyKey,
        createdAt,
        claim.id,
        principalId,
        createdAt,
      ),
    db
      .prepare(
        `UPDATE request_comments SET resolved_at = ?, resolved_by_asset_id = ?
         WHERE id IN (SELECT comment_id FROM claim_comments WHERE claim_id = ?)
           AND submitted_at IS NOT NULL AND resolved_at IS NULL
           AND EXISTS (
             SELECT 1 FROM work_claims
             WHERE id = ? AND service_token_id = ? AND completed_at = ?
           )`,
      )
      .bind(createdAt, storedAsset.id, claim.id, claim.id, principalId, createdAt),
  ]
  const committed = await db
    .batch(statements)
    .catch((cause) => new DatabaseFailureError({ operation: "atomic work result commit", cause }))
  if (committed instanceof Error) {
    const concurrentReplay = await findIdempotentWorkResult({
      db,
      claimId: claim.id,
      principalId,
      idempotencyKey,
    })
    if (concurrentReplay instanceof Error) return committed
    if (concurrentReplay.tag === "found") return concurrentReplay.value
    return committed
  }
  if (committed.some((result) => !result.success)) {
    return new DatabaseFailureError({ operation: "atomic work result commit" })
  }
  if ((committed[0]?.meta.changes ?? 0) === 0) {
    const concurrentReplay = await findIdempotentWorkResult({
      db,
      claimId: claim.id,
      principalId,
      idempotencyKey,
    })
    if (concurrentReplay instanceof Error) return concurrentReplay
    if (concurrentReplay.tag === "found") return concurrentReplay.value

    const claimState = await requireOwnedClaim({
      db,
      claimId: claim.id,
      principalId,
      now,
    })
    if (claimState instanceof Error) return claimState
    return new DatabaseFailureError({ operation: "atomic work result claim transition" })
  }

  const row = await findWorkResultByIdempotency({ db, idempotencyKey })
  if (row instanceof Error) return row
  if (row.tag === "missing") return new DatabaseFailureError({ operation: "work result readback" })
  return loadWorkResult({ db, row: row.value, lifecycleTag: "created" })
}
