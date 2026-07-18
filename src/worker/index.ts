import * as errore from "errore"
import { OpenAPIHono, z } from "@hono/zod-openapi"
import { Scalar } from "@scalar/hono-api-reference"
import { deleteCookie, setCookie } from "hono/cookie"
import {
  AssetIdSchema,
  AssetLifecycleInputSchema,
  AssetSchema,
  AssetTagInputSchema,
  LibrarySchema,
  LibraryViewSchema,
  LoginInputSchema,
  SessionSchema,
  ServiceTokenCreatedSchema,
  ServiceTokenInputSchema,
  ServiceTokenListSchema,
  ServiceTokenSchema,
  TagInputSchema,
  TagSchema,
  TagSlugSchema,
  UploadResponseSchema,
} from "@/shared/domain"
import { deleteAsset } from "./assets/delete-service"
import { assetHtmlResponse } from "./assets/response"
import { uploadAsset } from "./assets/service"
import { authorize, authorizeBrowserSession, checkPasswordAttempt } from "./auth/authorize"
import { createSessionToken, sessionCookieOptions } from "./auth/session"
import { createServiceTokenMaterial } from "./auth/service-token"
import { AssetBoxCoordinator } from "./coordinator"
import {
  createTag,
  deleteTag,
  getLibrary,
  replaceAssetTags,
  requireAsset,
  setAssetLifecycle,
  updateTag,
} from "./data/repository"
import {
  insertServiceToken,
  listServiceTokens,
  revokeServiceToken,
} from "./data/service-token-repository"
import { InternalFailureError, InvalidInputError, StorageFailureError } from "./errors"
import {
  type AppContext,
  commonErrorResponses,
  jsonContent,
  parseJsonInput,
  respondError,
} from "./http"
import { notifyClients } from "./realtime"
import { registerPublicShareRoutes } from "./public-shares/routes"
import { registerWorkRequestRoutes } from "./work-requests/routes"

export { AssetBoxCoordinator }

const app = new OpenAPIHono<AppContext>()

const UploadFormSchema = z.object({
  html: z.instanceof(File).openapi({ type: "string", format: "binary" }),
  title: z.string().trim().min(1).max(120),
  blurb: z.string().trim().min(1).max(280),
  tags: z.string().default("[]"),
})

app.get("/api/session", async (c) => {
  const auth = await authorize(c)
  if (auth instanceof Error) {
    if (!errore.findCause(auth, InternalFailureError)) return c.json({ authenticated: false })
    return respondError(c, auth)
  }
  return c.json({ authenticated: true })
})

app.post("/api/login", async (c) => {
  const input = await parseJsonInput({ read: () => c.req.json(), schema: LoginInputSchema })
  if (input instanceof Error) return respondError(c, input)

  const auth = await checkPasswordAttempt({ c, password: input.password })
  if (auth instanceof Error) return respondError(c, auth)

  const token = await createSessionToken({ secret: c.env.SESSION_SECRET, now: new Date() })
  if (token instanceof Error) return respondError(c, token)
  setCookie(c, "asset_box_session", token, sessionCookieOptions)
  return c.json({ authenticated: true })
})

app.post("/api/logout", (c) => {
  deleteCookie(c, "asset_box_session", { path: "/", secure: true })
  return c.json({ authenticated: false })
})

app.get("/api/service-tokens", async (c) => {
  const auth = await authorizeBrowserSession(c)
  if (auth instanceof Error) return respondError(c, auth)

  const serviceTokens = await listServiceTokens({ db: c.env.ASSET_BOX_DB, now: new Date() })
  if (serviceTokens instanceof Error) return respondError(c, serviceTokens)
  return c.json(serviceTokens)
})

app.post("/api/service-tokens", async (c) => {
  const auth = await authorizeBrowserSession(c)
  if (auth instanceof Error) return respondError(c, auth)
  const input = await parseJsonInput({ read: () => c.req.json(), schema: ServiceTokenInputSchema })
  if (input instanceof Error) return respondError(c, input)

  const now = new Date()
  if (input.expiresAt !== undefined && input.expiresAt <= now.toISOString()) {
    return respondError(
      c,
      new InvalidInputError({ reason: "Service token expiration must be in the future" }),
    )
  }

  const material = await createServiceTokenMaterial()
  if (material instanceof Error) return respondError(c, material)
  const serviceToken = await insertServiceToken({
    db: c.env.ASSET_BOX_DB,
    id: crypto.randomUUID(),
    input,
    prefix: material.prefix,
    tokenHash: material.tokenHash,
    now,
  })
  if (serviceToken instanceof Error) return respondError(c, serviceToken)
  return c.json({ serviceToken, token: material.token }, 201)
})

app.delete("/api/service-tokens/:id", async (c) => {
  const auth = await authorizeBrowserSession(c)
  if (auth instanceof Error) return respondError(c, auth)
  const id = z.uuid().safeParse(c.req.param("id"))
  if (!id.success) {
    return respondError(c, new InvalidInputError({ reason: "Service token id is invalid" }))
  }

  const serviceToken = await revokeServiceToken({
    db: c.env.ASSET_BOX_DB,
    id: id.data,
    now: new Date(),
  })
  if (serviceToken instanceof Error) return respondError(c, serviceToken)
  return c.json(serviceToken)
})

app.get("/api/library", async (c) => {
  const auth = await authorize(c)
  if (auth instanceof Error) return respondError(c, auth)
  const view = LibraryViewSchema.safeParse(c.req.query("view") ?? "active")
  if (!view.success) {
    return respondError(c, new InvalidInputError({ reason: "Library view is invalid" }))
  }
  const library = await getLibrary({ db: c.env.ASSET_BOX_DB, view: view.data })
  if (library instanceof Error) return respondError(c, library)
  return c.json(library)
})

app.post("/api/tags", async (c) => {
  const auth = await authorize(c)
  if (auth instanceof Error) return respondError(c, auth)
  const input = await parseJsonInput({ read: () => c.req.json(), schema: TagInputSchema })
  if (input instanceof Error) return respondError(c, input)

  const tag = await createTag({ db: c.env.ASSET_BOX_DB, input, now: new Date() })
  if (tag instanceof Error) return respondError(c, tag)
  await notifyClients({ c, event: { tag: "tags-changed" } })
  return c.json(tag, 201)
})

app.put("/api/tags/:id", async (c) => {
  const auth = await authorize(c)
  if (auth instanceof Error) return respondError(c, auth)
  const id = z.uuid().safeParse(c.req.param("id"))
  if (!id.success) return respondError(c, new InvalidInputError({ reason: "Tag id is invalid" }))
  const input = await parseJsonInput({ read: () => c.req.json(), schema: TagInputSchema })
  if (input instanceof Error) return respondError(c, input)

  const tag = await updateTag({ db: c.env.ASSET_BOX_DB, id: id.data, input })
  if (tag instanceof Error) return respondError(c, tag)
  await notifyClients({ c, event: { tag: "tags-changed" } })
  return c.json(tag)
})

app.delete("/api/tags/:id", async (c) => {
  const auth = await authorize(c)
  if (auth instanceof Error) return respondError(c, auth)
  const id = z.uuid().safeParse(c.req.param("id"))
  if (!id.success) return respondError(c, new InvalidInputError({ reason: "Tag id is invalid" }))

  const result = await deleteTag({ db: c.env.ASSET_BOX_DB, id: id.data })
  if (result instanceof Error) return respondError(c, result)
  await notifyClients({ c, event: { tag: "tags-changed" } })
  return c.body(null, 204)
})

app.post("/api/assets", async (c) => {
  const auth = await authorize(c)
  if (auth instanceof Error) return respondError(c, auth)
  const rawForm = await c.req
    .formData()
    .catch((cause) => new InvalidInputError({ reason: "Upload form is invalid", cause }))
  if (rawForm instanceof Error) return respondError(c, rawForm)
  const form = UploadFormSchema.safeParse(Object.fromEntries(rawForm))
  if (!form.success) {
    return respondError(
      c,
      new InvalidInputError({ reason: form.error.issues.map((issue) => issue.message).join("; ") }),
    )
  }

  const tagSlugs = errore.try({
    try: () => z.array(TagSlugSchema).parse(JSON.parse(form.data.tags)),
    catch: (cause) =>
      new InvalidInputError({ reason: "Tags must be a JSON array of tag slugs", cause }),
  })
  if (tagSlugs instanceof Error) return respondError(c, tagSlugs)

  const result = await uploadAsset({
    env: c.env,
    input: {
      file: form.data.html,
      title: form.data.title,
      blurb: form.data.blurb,
      tagSlugs,
    },
    now: new Date(),
  })
  if (result instanceof Error) return respondError(c, result)

  if (result.status === "created") {
    await notifyClients({ c, event: { tag: "asset-created", asset: result.asset } })
  }

  if (result.status === "created") return c.json(result, 201)
  return c.json(result)
})

app.put("/api/assets/:id/lifecycle", async (c) => {
  const auth = await authorize(c)
  if (auth instanceof Error) return respondError(c, auth)
  const id = AssetIdSchema.safeParse(c.req.param("id"))
  if (!id.success) {
    return respondError(c, new InvalidInputError({ reason: "Asset id is invalid" }))
  }
  const input = await parseJsonInput({
    read: () => c.req.json(),
    schema: AssetLifecycleInputSchema,
  })
  if (input instanceof Error) return respondError(c, input)

  const asset = await setAssetLifecycle({
    db: c.env.ASSET_BOX_DB,
    id: id.data,
    input,
    now: new Date(),
  })
  if (asset instanceof Error) return respondError(c, asset)
  await notifyClients({ c, event: { tag: "asset-updated", asset } })
  return c.json(asset)
})

app.put("/api/assets/:id/tags", async (c) => {
  const auth = await authorize(c)
  if (auth instanceof Error) return respondError(c, auth)
  const id = AssetIdSchema.safeParse(c.req.param("id"))
  if (!id.success) {
    return respondError(c, new InvalidInputError({ reason: "Asset id is invalid" }))
  }
  const input = await parseJsonInput({ read: () => c.req.json(), schema: AssetTagInputSchema })
  if (input instanceof Error) return respondError(c, input)

  const asset = await replaceAssetTags({
    db: c.env.ASSET_BOX_DB,
    id: id.data,
    tagSlugs: input.tagSlugs,
  })
  if (asset instanceof Error) return respondError(c, asset)
  await notifyClients({ c, event: { tag: "asset-updated", asset } })
  return c.json(asset)
})

app.delete("/api/assets/:id", async (c) => {
  const auth = await authorize(c)
  if (auth instanceof Error) return respondError(c, auth)
  const id = AssetIdSchema.safeParse(c.req.param("id"))
  if (!id.success) {
    return respondError(c, new InvalidInputError({ reason: "Asset id is invalid" }))
  }

  const result = await deleteAsset({ env: c.env, id: id.data, now: new Date() })
  if (result instanceof Error) return respondError(c, result)
  await notifyClients({ c, event: { tag: "asset-deleted", assetId: id.data } })
  return c.body(null, 204)
})

app.get("/view/:id", async (c) => {
  const auth = await authorize(c)
  if (auth instanceof Error) return respondError(c, auth)
  const id = AssetIdSchema.safeParse(c.req.param("id"))
  if (!id.success) {
    return respondError(c, new InvalidInputError({ reason: "Asset id is invalid" }))
  }
  const metadata = await requireAsset({ db: c.env.ASSET_BOX_DB, id: id.data })
  if (metadata instanceof Error) return respondError(c, metadata)

  const object = await c.env.ASSET_BOX_BUCKET.get(`assets/${id.data}.html`).catch(
    (cause) => new StorageFailureError({ operation: "asset read", cause }),
  )
  if (object instanceof Error) return respondError(c, object)
  if (object === null) {
    return respondError(c, new StorageFailureError({ operation: "asset read" }))
  }

  return assetHtmlResponse({
    body: object.body,
    cacheControl: "private, max-age=3600",
    disposition: "inline",
    filename: `${id.data}.html`,
  })
})

app.get("/api/events", async (c) => {
  const auth = await authorize(c)
  if (auth instanceof Error) return respondError(c, auth)
  const coordinator = c.env.COORDINATOR.get(c.env.COORDINATOR.idFromName("events"))
  return coordinator.fetch("https://coordinator/events")
})

app.openAPIRegistry.registerComponent("securitySchemes", "sessionCookie", {
  type: "apiKey",
  in: "cookie",
  name: "asset_box_session",
})
app.openAPIRegistry.registerComponent("securitySchemes", "serviceToken", {
  type: "http",
  scheme: "bearer",
  description: "Use a service token created in the authenticated web interface.",
})

registerPublicShareRoutes(app)
registerWorkRequestRoutes(app)

const browserSessionSecurity: Record<string, string[]>[] = [{ sessionCookie: [] }]

const protectedSecurity: Record<string, string[]>[] = [
  ...browserSessionSecurity,
  { serviceToken: [] },
]

app.openAPIRegistry.registerPath({
  method: "get",
  path: "/api/session",
  tags: ["Authentication"],
  responses: { ...commonErrorResponses, 200: jsonContent(SessionSchema, "Authentication state") },
})
app.openAPIRegistry.registerPath({
  method: "post",
  path: "/api/login",
  tags: ["Authentication"],
  request: { body: { content: { "application/json": { schema: LoginInputSchema } } } },
  responses: { ...commonErrorResponses, 200: jsonContent(SessionSchema, "Authenticated session") },
})
app.openAPIRegistry.registerPath({
  method: "post",
  path: "/api/logout",
  tags: ["Authentication"],
  responses: { 200: jsonContent(SessionSchema, "Signed-out session") },
})
app.openAPIRegistry.registerPath({
  method: "get",
  path: "/api/service-tokens",
  tags: ["Service tokens"],
  security: browserSessionSecurity,
  responses: {
    ...commonErrorResponses,
    200: jsonContent(ServiceTokenListSchema, "Service token metadata"),
  },
})
app.openAPIRegistry.registerPath({
  method: "post",
  path: "/api/service-tokens",
  tags: ["Service tokens"],
  security: browserSessionSecurity,
  request: { body: { content: { "application/json": { schema: ServiceTokenInputSchema } } } },
  responses: {
    ...commonErrorResponses,
    201: jsonContent(ServiceTokenCreatedSchema, "Created service token and one-time secret"),
  },
})
app.openAPIRegistry.registerPath({
  method: "delete",
  path: "/api/service-tokens/{id}",
  tags: ["Service tokens"],
  security: browserSessionSecurity,
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    ...commonErrorResponses,
    200: jsonContent(ServiceTokenSchema, "Revoked service token"),
  },
})
app.openAPIRegistry.registerPath({
  method: "get",
  path: "/api/library",
  tags: ["Library"],
  security: protectedSecurity,
  request: { query: z.object({ view: LibraryViewSchema.optional() }) },
  responses: { ...commonErrorResponses, 200: jsonContent(LibrarySchema, "Asset library") },
})
app.openAPIRegistry.registerPath({
  method: "post",
  path: "/api/tags",
  tags: ["Tags"],
  security: protectedSecurity,
  request: { body: { content: { "application/json": { schema: TagInputSchema } } } },
  responses: { ...commonErrorResponses, 201: jsonContent(TagSchema, "Created tag") },
})
app.openAPIRegistry.registerPath({
  method: "put",
  path: "/api/tags/{id}",
  tags: ["Tags"],
  security: protectedSecurity,
  request: {
    params: z.object({ id: z.uuid() }),
    body: { content: { "application/json": { schema: TagInputSchema } } },
  },
  responses: { ...commonErrorResponses, 200: jsonContent(TagSchema, "Updated tag") },
})
app.openAPIRegistry.registerPath({
  method: "delete",
  path: "/api/tags/{id}",
  tags: ["Tags"],
  security: protectedSecurity,
  request: { params: z.object({ id: z.uuid() }) },
  responses: { ...commonErrorResponses, 204: { description: "Tag deleted" } },
})
app.openAPIRegistry.registerPath({
  method: "post",
  path: "/api/assets",
  tags: ["Assets"],
  security: protectedSecurity,
  request: {
    body: { content: { "multipart/form-data": { schema: UploadFormSchema } } },
  },
  responses: {
    ...commonErrorResponses,
    200: jsonContent(UploadResponseSchema, "Existing duplicate asset"),
    201: jsonContent(UploadResponseSchema, "Created asset"),
  },
})
app.openAPIRegistry.registerPath({
  method: "put",
  path: "/api/assets/{id}/lifecycle",
  tags: ["Assets"],
  security: protectedSecurity,
  request: {
    params: z.object({ id: AssetIdSchema }),
    body: { content: { "application/json": { schema: AssetLifecycleInputSchema } } },
  },
  responses: { ...commonErrorResponses, 200: jsonContent(AssetSchema, "Updated asset") },
})
app.openAPIRegistry.registerPath({
  method: "put",
  path: "/api/assets/{id}/tags",
  tags: ["Assets"],
  security: protectedSecurity,
  request: {
    params: z.object({ id: AssetIdSchema }),
    body: { content: { "application/json": { schema: AssetTagInputSchema } } },
  },
  responses: { ...commonErrorResponses, 200: jsonContent(AssetSchema, "Retagged asset") },
})
app.openAPIRegistry.registerPath({
  method: "delete",
  path: "/api/assets/{id}",
  tags: ["Assets"],
  security: protectedSecurity,
  request: { params: z.object({ id: AssetIdSchema }) },
  responses: { ...commonErrorResponses, 204: { description: "Asset deleted" } },
})

app.use("/api/docs", async (c, next) => {
  const auth = await authorize(c)
  if (auth instanceof Error) return respondError(c, auth)
  return next()
})

app.doc("/api/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Asset Box API",
    version: "0.1.0",
    description:
      "Manage content-addressed HTML assets, durable work requests, agent claims, and immutable result revisions.",
  },
})

app.get(
  "/api/docs",
  Scalar({
    spec: { url: "/api/openapi.json" },
    pageTitle: "Asset Box API",
    theme: "alternate",
  }),
)

app.notFound((c) => {
  if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/view/")) {
    return c.json({ error: { code: "ASSET_NOT_FOUND" as const, message: "Route not found" } }, 404)
  }
  return c.env.ASSETS.fetch(c.req.raw)
})

app.onError((error, c) => {
  console.error("Unhandled Worker error", error)
  return respondError(c, new InternalFailureError({ operation: "request handling", cause: error }))
})

export default app
