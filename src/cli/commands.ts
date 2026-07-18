import * as errore from "errore"
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { ApiErrorSchema, UploadResponseSchema } from "@/shared/domain"
import {
  AgentWorkListSchema,
  AgentWorkTargetSchema,
  WorkClaimSchema,
  WorkPullContextSchema,
  WorkResultPushInputSchema,
  WorkResultSchema,
} from "@/shared/work-requests"
import type { PullArgumentsSchema, PushArgumentsSchema, UploadArgumentsSchema } from "./arguments"

export class CliFileError extends errore.createTaggedError({
  name: "CliFileError",
  message: "Could not $operation $file",
}) {}

export class CliRequestError extends errore.createTaggedError({
  name: "CliRequestError",
  message: "$message",
}) {}

const PullManifestSchema = z.object({
  version: z.literal(1),
  serviceUrl: z.url(),
  claim: WorkClaimSchema,
  target: AgentWorkTargetSchema,
  comments: WorkPullContextSchema.shape.comments,
  source: z.discriminatedUnion("tag", [
    z.object({ tag: z.literal("none") }),
    z.object({
      tag: z.literal("html"),
      assetId: z.string().regex(/^[a-f0-9]{64}$/),
      file: z.literal("source.html"),
    }),
  ]),
})

type UploadArguments = z.infer<typeof UploadArgumentsSchema>
type PullArguments = z.infer<typeof PullArgumentsSchema>
type PushArguments = z.infer<typeof PushArgumentsSchema>

function authorization(serviceToken: string) {
  return { Authorization: `Bearer ${serviceToken}` }
}

async function parseResponseJson({
  response,
  operation,
}: {
  response: Response
  operation: string
}) {
  const payload = await response
    .json()
    .catch((cause) => new CliRequestError({ message: `${operation} response was not JSON`, cause }))
  if (payload instanceof Error) return payload
  if (response.ok) return payload

  const apiError = ApiErrorSchema.safeParse(payload)
  if (apiError.success) return new CliRequestError({ message: apiError.data.error.message })
  return new CliRequestError({ message: `${operation} returned HTTP ${response.status}` })
}

async function requestJson<T>({
  url,
  serviceToken,
  pathName,
  operation,
  schema,
  method = "GET",
  body,
}: {
  url: string
  serviceToken: string
  pathName: string
  operation: string
  schema: z.ZodType<T>
  method?: "GET" | "POST"
  body?: unknown
}) {
  const endpoint = new URL(pathName, url)
  const response = await fetch(endpoint, {
    method,
    headers: {
      ...authorization(serviceToken),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((cause) => new CliRequestError({ message: `${operation} request failed`, cause }))
  if (response instanceof Error) return response

  const payload = await parseResponseJson({ response, operation })
  if (payload instanceof Error) return payload
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    return new CliRequestError({ message: `${operation} response had an unexpected shape` })
  }
  return parsed.data
}

export async function uploadAssetFile(args: UploadArguments) {
  const absoluteFile = path.resolve(args.file)
  const html = await fs.promises
    .readFile(absoluteFile)
    .catch((cause) => new CliFileError({ operation: "read", file: absoluteFile, cause }))
  if (html instanceof Error) return html

  const form = new FormData()
  form.set("html", new File([html], path.basename(absoluteFile), { type: "text/html" }))
  form.set("title", args.title)
  form.set("blurb", args.blurb)
  form.set("tags", JSON.stringify(args.tags))

  const endpoint = new URL("/api/assets", args.url)
  const response = await fetch(endpoint, {
    method: "POST",
    headers: authorization(args.serviceToken),
    body: form,
  }).catch((cause) => new CliRequestError({ message: "Upload request failed", cause }))
  if (response instanceof Error) return response
  const payload = await parseResponseJson({ response, operation: "Upload" })
  if (payload instanceof Error) return payload
  const result = UploadResponseSchema.safeParse(payload)
  if (!result.success)
    return new CliRequestError({ message: "Upload response had an unexpected shape" })
  return result.data
}

export async function pullWorkRequest(args: PullArguments) {
  const list = await requestJson({
    url: args.url,
    serviceToken: args.serviceToken,
    pathName: "/api/agent/work-requests",
    operation: "Work listing",
    schema: AgentWorkListSchema,
  })
  if (list instanceof Error) return list

  const request = args.requestId
    ? list.requests.find((candidate) => candidate.requestId === args.requestId)
    : list.requests.find((candidate) => candidate.availability.tag === "available")
  if (!request) {
    return new CliRequestError({
      message: args.requestId
        ? `Submitted work request ${args.requestId} is not available`
        : "No submitted work requests are available",
    })
  }

  const claim = await requestJson({
    url: args.url,
    serviceToken: args.serviceToken,
    pathName: `/api/agent/work-requests/${request.requestId}/claim`,
    operation: "Work claim",
    schema: WorkClaimSchema,
    method: "POST",
    body: { leaseSeconds: args.leaseSeconds },
  })
  if (claim instanceof Error) return claim

  const context = await requestJson({
    url: args.url,
    serviceToken: args.serviceToken,
    pathName: `/api/agent/claims/${claim.id}`,
    operation: "Work pull",
    schema: WorkPullContextSchema,
  })
  if (context instanceof Error) return context

  const directory = path.resolve(args.out)
  const created = await fs.promises
    .mkdir(directory, { recursive: true })
    .catch((cause) => new CliFileError({ operation: "create directory", file: directory, cause }))
  if (created instanceof Error) return created

  if (context.source.tag === "html") {
    const sourceFile = path.join(directory, "source.html")
    const written = await fs.promises
      .writeFile(sourceFile, context.source.html, { flag: "wx" })
      .catch((cause) => new CliFileError({ operation: "write", file: sourceFile, cause }))
    if (written instanceof Error) return written
  }

  const manifest = PullManifestSchema.parse({
    version: 1,
    serviceUrl: args.url,
    claim: context.claim,
    target: context.target,
    comments: context.comments,
    source:
      context.source.tag === "none"
        ? { tag: "none" }
        : { tag: "html", assetId: context.source.assetId, file: "source.html" },
  })
  const manifestFile = path.join(directory, "request.json")
  const written = await fs.promises
    .writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" })
    .catch((cause) => new CliFileError({ operation: "write", file: manifestFile, cause }))
  if (written instanceof Error) return written

  return { directory, manifest }
}

export async function pushWorkRequestResult(args: PushArguments) {
  const directory = path.resolve(args.directory)
  const manifestFile = path.join(directory, "request.json")
  const rawManifest = await fs.promises
    .readFile(manifestFile, "utf8")
    .catch((cause) => new CliFileError({ operation: "read", file: manifestFile, cause }))
  if (rawManifest instanceof Error) return rawManifest
  const manifest = errore.try({
    try: () => PullManifestSchema.parse(JSON.parse(rawManifest) as unknown),
    catch: (cause) => new CliFileError({ operation: "parse", file: manifestFile, cause }),
  })
  if (manifest instanceof Error) return manifest

  const htmlFile = path.resolve(directory, args.html)
  const html = await fs.promises
    .readFile(htmlFile, "utf8")
    .catch((cause) => new CliFileError({ operation: "read", file: htmlFile, cause }))
  if (html instanceof Error) return html

  const input = WorkResultPushInputSchema.safeParse({
    idempotencyKey: manifest.claim.resultIdempotencyKey,
    html,
    title: args.title ?? manifest.target.title,
    blurb: args.blurb ?? manifest.target.blurb,
    tagSlugs: args.tags,
  })
  if (!input.success) {
    return new CliFileError({ operation: "validate result metadata from", file: manifestFile })
  }

  return requestJson({
    url: args.url || manifest.serviceUrl,
    serviceToken: args.serviceToken,
    pathName: `/api/agent/claims/${manifest.claim.id}/result`,
    operation: "Result push",
    schema: WorkResultSchema,
    method: "POST",
    body: input.data,
  })
}
