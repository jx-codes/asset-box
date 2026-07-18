import { z } from "@hono/zod-openapi"
import { AssetIdSchema, AssetSchema, TagSlugSchema } from "./domain"

export const WorkRequestIdSchema = z.string().uuid().openapi("WorkRequestId")
export const WorkCommentIdSchema = z.string().uuid().openapi("WorkCommentId")
export const WorkClaimIdSchema = z.string().uuid().openapi("WorkClaimId")

export const WorkCommentBodySchema = z.string().trim().min(1).max(4000).openapi("WorkCommentBody")

export const WorkRequestCreateInputSchema = z
  .discriminatedUnion("tag", [
    z.object({ tag: z.literal("asset-edit"), parentAssetId: AssetIdSchema }),
    z.object({
      tag: z.literal("new-asset"),
      title: z.string().trim().min(1).max(120),
      blurb: z.string().trim().min(1).max(280),
    }),
  ])
  .openapi("WorkRequestCreateInput")

export const WorkCommentInputSchema = z
  .object({ body: WorkCommentBodySchema })
  .openapi("WorkCommentInput")

export const WorkCommentLifecycleSchema = z
  .discriminatedUnion("tag", [
    z.object({ tag: z.literal("draft") }),
    z.object({ tag: z.literal("submitted"), submittedAt: z.string().datetime() }),
    z.object({
      tag: z.literal("resolved"),
      submittedAt: z.string().datetime(),
      resolvedAt: z.string().datetime(),
      resultAssetId: AssetIdSchema,
    }),
  ])
  .openapi("WorkCommentLifecycle")

export const WorkCommentSchema = z
  .object({
    id: WorkCommentIdSchema,
    requestId: WorkRequestIdSchema,
    body: WorkCommentBodySchema,
    createdAt: z.string().datetime(),
    lifecycle: WorkCommentLifecycleSchema,
  })
  .openapi("WorkComment")

export const WorkRequestTargetSchema = z
  .discriminatedUnion("tag", [
    z.object({ tag: z.literal("asset-edit"), asset: AssetSchema }),
    z.object({
      tag: z.literal("new-asset"),
      title: z.string().min(1).max(120),
      blurb: z.string().min(1).max(280),
    }),
  ])
  .openapi("WorkRequestTarget")

export const WorkRequestLifecycleSchema = z
  .discriminatedUnion("tag", [
    z.object({ tag: z.literal("draft") }),
    z.object({ tag: z.literal("submitted") }),
    z.object({
      tag: z.literal("claimed"),
      claimId: WorkClaimIdSchema,
      claimedByPrincipalId: z.string().uuid(),
      expiresAt: z.string().datetime(),
    }),
    z.object({ tag: z.literal("completed"), completedAt: z.string().datetime() }),
  ])
  .openapi("WorkRequestLifecycle")

export const WorkRequestSchema = z
  .object({
    id: WorkRequestIdSchema,
    target: WorkRequestTargetSchema,
    createdAt: z.string().datetime(),
    lifecycle: WorkRequestLifecycleSchema,
    comments: z.array(WorkCommentSchema),
  })
  .openapi("WorkRequest")

export const WorkRequestListSchema = z
  .object({ requests: z.array(WorkRequestSchema) })
  .openapi("WorkRequestList")

export const WorkRequestListQuerySchema = z
  .discriminatedUnion("tag", [
    z.object({ tag: z.literal("asset-edit"), parentAssetId: AssetIdSchema }),
    z.object({ tag: z.literal("new-asset") }),
  ])
  .openapi("WorkRequestListQuery")

export const WorkClaimInputSchema = z
  .object({ leaseSeconds: z.number().int().min(60).max(3600).default(900) })
  .openapi("WorkClaimInput")

export const ActiveWorkClaimLifecycleSchema = z
  .object({ tag: z.literal("active"), expiresAt: z.string().datetime() })
  .openapi("ActiveWorkClaimLifecycle")

export const WorkClaimLifecycleSchema = z
  .discriminatedUnion("tag", [
    ActiveWorkClaimLifecycleSchema,
    z.object({ tag: z.literal("expired"), expiredAt: z.string().datetime() }),
    z.object({
      tag: z.literal("completed"),
      completedAt: z.string().datetime(),
      resultAssetId: AssetIdSchema,
    }),
  ])
  .openapi("WorkClaimLifecycle")

export const WorkClaimSchema = z
  .object({
    id: WorkClaimIdSchema,
    requestId: WorkRequestIdSchema,
    claimedByPrincipalId: z.string().uuid(),
    claimedAt: z.string().datetime(),
    lifecycle: ActiveWorkClaimLifecycleSchema,
    resultIdempotencyKey: z.string().uuid(),
    commentIds: z.array(WorkCommentIdSchema).min(1),
  })
  .openapi("WorkClaim")

export const SubmittedWorkCommentSchema = z
  .object({
    id: WorkCommentIdSchema,
    body: WorkCommentBodySchema,
    submittedAt: z.string().datetime(),
  })
  .openapi("SubmittedWorkComment")

export const AgentWorkTargetSchema = z
  .discriminatedUnion("tag", [
    z.object({
      tag: z.literal("asset-edit"),
      parentAssetId: AssetIdSchema,
      title: z.string().min(1).max(120),
      blurb: z.string().min(1).max(280),
    }),
    z.object({
      tag: z.literal("new-asset"),
      title: z.string().min(1).max(120),
      blurb: z.string().min(1).max(280),
    }),
  ])
  .openapi("AgentWorkTarget")

export const AgentWorkSummarySchema = z
  .object({
    requestId: WorkRequestIdSchema,
    target: AgentWorkTargetSchema,
    submittedCommentCount: z.number().int().positive(),
    oldestSubmittedAt: z.string().datetime(),
    availability: z.discriminatedUnion("tag", [
      z.object({ tag: z.literal("available") }),
      z.object({ tag: z.literal("claimed"), expiresAt: z.string().datetime() }),
    ]),
  })
  .openapi("AgentWorkSummary")

export const AgentWorkListSchema = z
  .object({ requests: z.array(AgentWorkSummarySchema) })
  .openapi("AgentWorkList")

export const WorkSourceSchema = z
  .discriminatedUnion("tag", [
    z.object({ tag: z.literal("none") }),
    z.object({ tag: z.literal("html"), assetId: AssetIdSchema, html: z.string().min(1) }),
  ])
  .openapi("WorkSource")

export const WorkPullContextSchema = z
  .object({
    claim: WorkClaimSchema,
    target: AgentWorkTargetSchema,
    comments: z.array(SubmittedWorkCommentSchema).min(1),
    source: WorkSourceSchema,
  })
  .openapi("WorkPullContext")

export const WorkResultPushInputSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    html: z
      .string()
      .min(1)
      .max(5 * 1024 * 1024),
    title: z.string().trim().min(1).max(120),
    blurb: z.string().trim().min(1).max(280),
    tagSlugs: z.array(TagSlugSchema).max(50).default([]),
  })
  .openapi("WorkResultPushInput")

export const WorkResultLineageSchema = z
  .object({
    requestId: WorkRequestIdSchema,
    claimId: WorkClaimIdSchema,
    parent: z.discriminatedUnion("tag", [
      z.object({ tag: z.literal("none") }),
      z.object({ tag: z.literal("asset"), assetId: AssetIdSchema }),
    ]),
    resolvedCommentIds: z.array(WorkCommentIdSchema).min(1),
  })
  .openapi("WorkResultLineage")

export const WorkResultLifecycleSchema = z
  .discriminatedUnion("tag", [
    z.object({ tag: z.literal("created") }),
    z.object({ tag: z.literal("replayed") }),
  ])
  .openapi("WorkResultLifecycle")

export const WorkResultSchema = z
  .object({
    lifecycle: WorkResultLifecycleSchema,
    asset: AssetSchema,
    lineage: WorkResultLineageSchema,
    createdAt: z.string().datetime(),
  })
  .openapi("WorkResult")

export type AgentWorkList = z.infer<typeof AgentWorkListSchema>
export type AgentWorkSummary = z.infer<typeof AgentWorkSummarySchema>
export type WorkClaim = z.infer<typeof WorkClaimSchema>
export type WorkClaimLifecycle = z.infer<typeof WorkClaimLifecycleSchema>
export type WorkClaimInput = z.infer<typeof WorkClaimInputSchema>
export type WorkComment = z.infer<typeof WorkCommentSchema>
export type WorkCommentInput = z.infer<typeof WorkCommentInputSchema>
export type WorkPullContext = z.infer<typeof WorkPullContextSchema>
export type WorkRequest = z.infer<typeof WorkRequestSchema>
export type WorkRequestCreateInput = z.infer<typeof WorkRequestCreateInputSchema>
export type WorkRequestListQuery = z.infer<typeof WorkRequestListQuerySchema>
export type WorkResult = z.infer<typeof WorkResultSchema>
export type WorkResultPushInput = z.infer<typeof WorkResultPushInputSchema>
export type WorkResultLifecycle = z.infer<typeof WorkResultLifecycleSchema>
