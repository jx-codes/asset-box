import * as errore from "errore"
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { ApiErrorSchema, AssetFilePathSchema, UploadResponseSchema } from "@/shared/domain"
import {
  AgentWorkListSchema,
  AgentWorkTargetSchema,
  WorkClaimSchema,
  WorkClaimFailureInputSchema,
  WorkClaimFailureSchema,
  WorkPullContextSchema,
  WorkResultPushInputSchema,
  WorkResultSchema,
} from "@/shared/work-requests"
import type {
  FailArgumentsSchema,
  PullArgumentsSchema,
  PushArgumentsSchema,
  UploadArgumentsSchema,
} from "./arguments"

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
      files: z.array(z.object({ path: AssetFilePathSchema, file: z.string().min(1) })).optional(),
    }),
  ]),
})

type UploadArguments = z.infer<typeof UploadArgumentsSchema>
type PullArguments = z.infer<typeof PullArgumentsSchema>
type PushArguments = z.infer<typeof PushArgumentsSchema>
type FailArguments = z.infer<typeof FailArgumentsSchema>

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

async function readLocalHtmlContent({ input, operation }: { input: string; operation: string }) {
  const absoluteInput = path.resolve(input)
  const stats = await fs.promises
    .stat(absoluteInput)
    .catch((cause) => new CliFileError({ operation: "inspect", file: absoluteInput, cause }))
  if (stats instanceof Error) return stats
  if (stats.isFile()) {
    const bytes = await fs.promises
      .readFile(absoluteInput)
      .catch((cause) => new CliFileError({ operation, file: absoluteInput, cause }))
    if (bytes instanceof Error) return bytes
    return { tag: "legacy-html" as const, file: absoluteInput, bytes }
  }
  if (!stats.isDirectory()) {
    return new CliFileError({ operation: "read HTML from", file: absoluteInput })
  }

  const entries = await fs.promises
    .readdir(absoluteInput, { recursive: true })
    .catch((cause) => new CliFileError({ operation: "list", file: absoluteInput, cause }))
  if (entries instanceof Error) return entries
  const htmlPaths = entries
    .filter((entry) => entry.toLowerCase().endsWith(".html"))
    .map((entry) => entry.split(path.sep).join("/"))
    .sort()
  const files: Array<{ path: string; file: string; bytes: Uint8Array }> = []
  for (const filePath of htmlPaths) {
    const parsedPath = AssetFilePathSchema.safeParse(filePath)
    if (!parsedPath.success) {
      return new CliFileError({ operation: "validate path in", file: absoluteInput })
    }
    const absoluteFile = path.join(absoluteInput, filePath)
    const bytes = await fs.promises
      .readFile(absoluteFile)
      .catch((cause) => new CliFileError({ operation, file: absoluteFile, cause }))
    if (bytes instanceof Error) return bytes
    files.push({ path: parsedPath.data, file: absoluteFile, bytes })
  }
  return { tag: "html-files" as const, files }
}

export async function uploadAssetFile(args: UploadArguments) {
  const content = await readLocalHtmlContent({ input: args.file, operation: "read" })
  if (content instanceof Error) return content

  const form = new FormData()
  if (content.tag === "legacy-html") {
    form.set("html", new File([content.bytes], path.basename(content.file), { type: "text/html" }))
  }
  if (content.tag === "html-files") {
    for (const file of content.files) {
      form.append("files", new File([file.bytes], path.basename(file.file), { type: "text/html" }))
    }
    form.set("filePaths", JSON.stringify(content.files.map((file) => file.path)))
  }
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
    if (context.source.files !== undefined) {
      const sourceDirectory = path.join(directory, "source")
      for (const source of context.source.files) {
        const sourcePath = path.join(sourceDirectory, source.path)
        const parentCreated = await fs.promises
          .mkdir(path.dirname(sourcePath), { recursive: true })
          .catch(
            (cause) =>
              new CliFileError({
                operation: "create directory",
                file: path.dirname(sourcePath),
                cause,
              }),
          )
        if (parentCreated instanceof Error) return parentCreated
        const sourceWritten = await fs.promises
          .writeFile(sourcePath, source.html, { flag: "wx" })
          .catch((cause) => new CliFileError({ operation: "write", file: sourcePath, cause }))
        if (sourceWritten instanceof Error) return sourceWritten
      }
    }
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
        : {
            tag: "html",
            assetId: context.source.assetId,
            file: "source.html",
            ...(context.source.files === undefined
              ? {}
              : {
                  files: context.source.files.map((source) => ({
                    path: source.path,
                    file: `source/${source.path}`,
                  })),
                }),
          },
  })
  const manifestFile = path.join(directory, "request.json")
  const written = await fs.promises
    .writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" })
    .catch((cause) => new CliFileError({ operation: "write", file: manifestFile, cause }))
  if (written instanceof Error) return written

  return { directory, manifest }
}

async function readPullManifest(directoryInput: string) {
  const directory = path.resolve(directoryInput)
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
  return { directory, manifestFile, manifest }
}

export async function pushWorkRequestResult(args: PushArguments) {
  const workspace = await readPullManifest(args.directory)
  if (workspace instanceof Error) return workspace
  const { directory, manifestFile, manifest } = workspace

  const content = await readLocalHtmlContent({
    input: path.resolve(directory, args.html),
    operation: "read",
  })
  if (content instanceof Error) return content
  const documents =
    content.tag === "legacy-html"
      ? { html: new TextDecoder().decode(content.bytes) }
      : {
          html: new TextDecoder().decode(
            content.files.find((file) => file.path === "index.html")?.bytes ?? new Uint8Array(),
          ),
          files: content.files.map((file) => ({
            path: file.path,
            html: new TextDecoder().decode(file.bytes),
          })),
        }

  const input = WorkResultPushInputSchema.safeParse({
    idempotencyKey: manifest.claim.resultIdempotencyKey,
    ...documents,
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

export async function failWorkRequest(args: FailArguments) {
  const workspace = await readPullManifest(args.directory)
  if (workspace instanceof Error) return workspace

  const input = WorkClaimFailureInputSchema.parse({ reason: args.reason })
  return requestJson({
    url: args.url || workspace.manifest.serviceUrl,
    serviceToken: args.serviceToken,
    pathName: `/api/agent/claims/${workspace.manifest.claim.id}/failure`,
    operation: "Failure report",
    schema: WorkClaimFailureSchema,
    method: "POST",
    body: input,
  })
}
