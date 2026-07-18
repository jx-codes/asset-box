import { type OpenAPIHono, z } from "@hono/zod-openapi"
import { AssetIdSchema } from "@/shared/domain"
import {
  AgentWorkListSchema,
  WorkClaimIdSchema,
  WorkClaimInputSchema,
  WorkClaimSchema,
  WorkCommentIdSchema,
  WorkCommentInputSchema,
  WorkCommentSchema,
  WorkPullContextSchema,
  WorkRequestCreateInputSchema,
  WorkRequestIdSchema,
  WorkRequestListSchema,
  WorkRequestSchema,
  WorkResultPushInputSchema,
  WorkResultSchema,
} from "@/shared/work-requests"
import { authorizeBrowserSession, authorizeServiceTokenPrincipal } from "../auth/authorize"
import {
  addDraftComment,
  claimWorkRequest,
  createWorkRequest,
  listAgentWork,
  listWorkRequests,
  requireWorkRequest,
  submitAllDraftComments,
  submitComment,
} from "../data/work-request-repository"
import { InvalidInputError } from "../errors"
import {
  type AppContext,
  commonErrorResponses,
  jsonContent,
  parseJsonInput,
  respondError,
} from "../http"
import { notifyClients } from "../realtime"
import { pullClaimContext, pushWorkResult } from "./service"

const browserSessionSecurity: Record<string, string[]>[] = [{ sessionCookie: [] }]
const serviceTokenSecurity: Record<string, string[]>[] = [{ serviceToken: [] }]

function parseRequestListQuery({ parentAssetId, kind }: { parentAssetId?: string; kind?: string }) {
  if (parentAssetId !== undefined && kind !== undefined) {
    return new InvalidInputError({
      reason: "Choose an asset request or new-asset requests, not both",
    })
  }
  if (parentAssetId !== undefined) {
    const parsed = AssetIdSchema.safeParse(parentAssetId)
    if (!parsed.success) return new InvalidInputError({ reason: "Parent asset id is invalid" })
    return { tag: "asset-edit" as const, parentAssetId: parsed.data }
  }
  if (kind === "new") return { tag: "new-asset" as const }
  return new InvalidInputError({ reason: "parentAssetId or kind=new is required" })
}

export function registerWorkRequestRoutes(app: OpenAPIHono<AppContext>) {
  app.get("/api/work-requests", async (c) => {
    const auth = await authorizeBrowserSession(c)
    if (auth instanceof Error) return respondError(c, auth)
    const query = parseRequestListQuery({
      parentAssetId: c.req.query("parentAssetId"),
      kind: c.req.query("kind"),
    })
    if (query instanceof Error) return respondError(c, query)

    const requests = await listWorkRequests({ db: c.env.ASSET_BOX_DB, query, now: new Date() })
    if (requests instanceof Error) return respondError(c, requests)
    return c.json(requests)
  })

  app.get("/api/work-requests/:id", async (c) => {
    const auth = await authorizeBrowserSession(c)
    if (auth instanceof Error) return respondError(c, auth)
    const id = WorkRequestIdSchema.safeParse(c.req.param("id"))
    if (!id.success)
      return respondError(c, new InvalidInputError({ reason: "Request id is invalid" }))

    const request = await requireWorkRequest({
      db: c.env.ASSET_BOX_DB,
      id: id.data,
      now: new Date(),
    })
    if (request instanceof Error) return respondError(c, request)
    return c.json(request)
  })

  app.post("/api/work-requests", async (c) => {
    const auth = await authorizeBrowserSession(c)
    if (auth instanceof Error) return respondError(c, auth)
    const input = await parseJsonInput({
      read: () => c.req.json(),
      schema: WorkRequestCreateInputSchema,
    })
    if (input instanceof Error) return respondError(c, input)

    const request = await createWorkRequest({ db: c.env.ASSET_BOX_DB, input, now: new Date() })
    if (request instanceof Error) return respondError(c, request)
    await notifyClients({ c, event: { tag: "work-request-changed", requestId: request.id } })
    return c.json(request, 201)
  })

  app.post("/api/work-requests/:id/comments", async (c) => {
    const auth = await authorizeBrowserSession(c)
    if (auth instanceof Error) return respondError(c, auth)
    const requestId = WorkRequestIdSchema.safeParse(c.req.param("id"))
    if (!requestId.success) {
      return respondError(c, new InvalidInputError({ reason: "Request id is invalid" }))
    }
    const input = await parseJsonInput({ read: () => c.req.json(), schema: WorkCommentInputSchema })
    if (input instanceof Error) return respondError(c, input)

    const comment = await addDraftComment({
      db: c.env.ASSET_BOX_DB,
      requestId: requestId.data,
      body: input.body,
      now: new Date(),
    })
    if (comment instanceof Error) return respondError(c, comment)
    await notifyClients({
      c,
      event: { tag: "work-request-changed", requestId: requestId.data },
    })
    return c.json(comment, 201)
  })

  app.post("/api/work-requests/:requestId/comments/:commentId/submit", async (c) => {
    const auth = await authorizeBrowserSession(c)
    if (auth instanceof Error) return respondError(c, auth)
    const requestId = WorkRequestIdSchema.safeParse(c.req.param("requestId"))
    const commentId = WorkCommentIdSchema.safeParse(c.req.param("commentId"))
    if (!requestId.success || !commentId.success) {
      return respondError(c, new InvalidInputError({ reason: "Request or comment id is invalid" }))
    }

    const comment = await submitComment({
      db: c.env.ASSET_BOX_DB,
      requestId: requestId.data,
      commentId: commentId.data,
      now: new Date(),
    })
    if (comment instanceof Error) return respondError(c, comment)
    await notifyClients({
      c,
      event: { tag: "work-request-changed", requestId: requestId.data },
    })
    return c.json(comment)
  })

  app.post("/api/work-requests/:id/comments/submit-all", async (c) => {
    const auth = await authorizeBrowserSession(c)
    if (auth instanceof Error) return respondError(c, auth)
    const requestId = WorkRequestIdSchema.safeParse(c.req.param("id"))
    if (!requestId.success) {
      return respondError(c, new InvalidInputError({ reason: "Request id is invalid" }))
    }

    const request = await submitAllDraftComments({
      db: c.env.ASSET_BOX_DB,
      requestId: requestId.data,
      now: new Date(),
    })
    if (request instanceof Error) return respondError(c, request)
    await notifyClients({
      c,
      event: { tag: "work-request-changed", requestId: requestId.data },
    })
    return c.json(request)
  })

  app.get("/api/agent/work-requests", async (c) => {
    const principal = await authorizeServiceTokenPrincipal(c)
    if (principal instanceof Error) return respondError(c, principal)

    const requests = await listAgentWork({ db: c.env.ASSET_BOX_DB, now: new Date() })
    if (requests instanceof Error) return respondError(c, requests)
    return c.json(requests)
  })

  app.post("/api/agent/work-requests/:id/claim", async (c) => {
    const principal = await authorizeServiceTokenPrincipal(c)
    if (principal instanceof Error) return respondError(c, principal)
    const requestId = WorkRequestIdSchema.safeParse(c.req.param("id"))
    if (!requestId.success) {
      return respondError(c, new InvalidInputError({ reason: "Request id is invalid" }))
    }
    const input = await parseJsonInput({ read: () => c.req.json(), schema: WorkClaimInputSchema })
    if (input instanceof Error) return respondError(c, input)

    const claim = await claimWorkRequest({
      db: c.env.ASSET_BOX_DB,
      requestId: requestId.data,
      principalId: principal.tokenId,
      leaseSeconds: input.leaseSeconds,
      now: new Date(),
    })
    if (claim instanceof Error) return respondError(c, claim)
    await notifyClients({
      c,
      event: { tag: "work-request-changed", requestId: requestId.data },
    })
    return c.json(claim, 201)
  })

  app.get("/api/agent/claims/:id", async (c) => {
    const principal = await authorizeServiceTokenPrincipal(c)
    if (principal instanceof Error) return respondError(c, principal)
    const claimId = WorkClaimIdSchema.safeParse(c.req.param("id"))
    if (!claimId.success) {
      return respondError(c, new InvalidInputError({ reason: "Claim id is invalid" }))
    }

    const context = await pullClaimContext({
      env: c.env,
      claimId: claimId.data,
      principalId: principal.tokenId,
      now: new Date(),
    })
    if (context instanceof Error) return respondError(c, context)
    return c.json(context)
  })

  app.post("/api/agent/claims/:id/result", async (c) => {
    const principal = await authorizeServiceTokenPrincipal(c)
    if (principal instanceof Error) return respondError(c, principal)
    const claimId = WorkClaimIdSchema.safeParse(c.req.param("id"))
    if (!claimId.success) {
      return respondError(c, new InvalidInputError({ reason: "Claim id is invalid" }))
    }
    const input = await parseJsonInput({
      read: () => c.req.json(),
      schema: WorkResultPushInputSchema,
    })
    if (input instanceof Error) return respondError(c, input)

    const result = await pushWorkResult({
      env: c.env,
      claimId: claimId.data,
      principalId: principal.tokenId,
      input,
      now: new Date(),
    })
    if (result instanceof Error) return respondError(c, result)
    await notifyClients({
      c,
      event: {
        tag: "work-result-created",
        requestId: result.lineage.requestId,
        asset: result.asset,
      },
    })
    return c.json(result, result.lifecycle.tag === "created" ? 201 : 200)
  })

  app.openAPIRegistry.registerPath({
    method: "get",
    path: "/api/work-requests",
    tags: ["Work requests"],
    security: browserSessionSecurity,
    request: {
      query: z.object({
        parentAssetId: AssetIdSchema.optional(),
        kind: z.literal("new").optional(),
      }),
    },
    responses: {
      ...commonErrorResponses,
      200: jsonContent(WorkRequestListSchema, "Durable browser-visible work requests"),
    },
  })
  app.openAPIRegistry.registerPath({
    method: "get",
    path: "/api/work-requests/{id}",
    tags: ["Work requests"],
    security: browserSessionSecurity,
    request: { params: z.object({ id: WorkRequestIdSchema }) },
    responses: { ...commonErrorResponses, 200: jsonContent(WorkRequestSchema, "Work request") },
  })
  app.openAPIRegistry.registerPath({
    method: "post",
    path: "/api/work-requests",
    tags: ["Work requests"],
    security: browserSessionSecurity,
    request: {
      body: { content: { "application/json": { schema: WorkRequestCreateInputSchema } } },
    },
    responses: { ...commonErrorResponses, 201: jsonContent(WorkRequestSchema, "Created request") },
  })
  app.openAPIRegistry.registerPath({
    method: "post",
    path: "/api/work-requests/{id}/comments",
    tags: ["Work requests"],
    security: browserSessionSecurity,
    request: {
      params: z.object({ id: WorkRequestIdSchema }),
      body: { content: { "application/json": { schema: WorkCommentInputSchema } } },
    },
    responses: { ...commonErrorResponses, 201: jsonContent(WorkCommentSchema, "Queued draft") },
  })
  app.openAPIRegistry.registerPath({
    method: "post",
    path: "/api/work-requests/{requestId}/comments/{commentId}/submit",
    tags: ["Work requests"],
    security: browserSessionSecurity,
    request: {
      params: z.object({ requestId: WorkRequestIdSchema, commentId: WorkCommentIdSchema }),
    },
    responses: {
      ...commonErrorResponses,
      200: jsonContent(WorkCommentSchema, "Submitted comment"),
    },
  })
  app.openAPIRegistry.registerPath({
    method: "post",
    path: "/api/work-requests/{id}/comments/submit-all",
    tags: ["Work requests"],
    security: browserSessionSecurity,
    request: { params: z.object({ id: WorkRequestIdSchema }) },
    responses: {
      ...commonErrorResponses,
      200: jsonContent(WorkRequestSchema, "Request after atomic draft submission"),
    },
  })
  app.openAPIRegistry.registerPath({
    method: "get",
    path: "/api/agent/work-requests",
    tags: ["Agent work"],
    security: serviceTokenSecurity,
    responses: {
      ...commonErrorResponses,
      200: jsonContent(AgentWorkListSchema, "Submitted work visible to agents"),
    },
  })
  app.openAPIRegistry.registerPath({
    method: "post",
    path: "/api/agent/work-requests/{id}/claim",
    tags: ["Agent work"],
    security: serviceTokenSecurity,
    request: {
      params: z.object({ id: WorkRequestIdSchema }),
      body: { content: { "application/json": { schema: WorkClaimInputSchema } } },
    },
    responses: { ...commonErrorResponses, 201: jsonContent(WorkClaimSchema, "Claimed snapshot") },
  })
  app.openAPIRegistry.registerPath({
    method: "get",
    path: "/api/agent/claims/{id}",
    tags: ["Agent work"],
    security: serviceTokenSecurity,
    request: { params: z.object({ id: WorkClaimIdSchema }) },
    responses: {
      ...commonErrorResponses,
      200: jsonContent(WorkPullContextSchema, "Claim context and optional source HTML"),
    },
  })
  app.openAPIRegistry.registerPath({
    method: "post",
    path: "/api/agent/claims/{id}/result",
    tags: ["Agent work"],
    security: serviceTokenSecurity,
    request: {
      params: z.object({ id: WorkClaimIdSchema }),
      body: { content: { "application/json": { schema: WorkResultPushInputSchema } } },
    },
    responses: {
      ...commonErrorResponses,
      200: jsonContent(WorkResultSchema, "Idempotently replayed result"),
      201: jsonContent(WorkResultSchema, "Created immutable result revision"),
    },
  })
}
