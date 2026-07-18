#!/usr/bin/env bun

import * as errore from "errore"
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { ApiErrorSchema, ServiceTokenSecretSchema, UploadResponseSchema } from "@/shared/domain"

class CliInputError extends errore.createTaggedError({
  name: "CliInputError",
  message: "$message",
}) {}

class CliFileError extends errore.createTaggedError({
  name: "CliFileError",
  message: "Could not read $file",
}) {}

class CliRequestError extends errore.createTaggedError({
  name: "CliRequestError",
  message: "$message",
}) {}

const UploadArgumentsSchema = z.object({
  command: z.literal("upload"),
  file: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  blurb: z.string().trim().min(1).max(280),
  tags: z.array(z.string()).default([]),
  url: z.url(),
  serviceToken: ServiceTokenSecretSchema,
})

type ArgumentState = {
  positionals: string[]
  options: Record<string, string>
}

function collectArguments({
  tokens,
  index,
  state,
}: {
  tokens: string[]
  index: number
  state: ArgumentState
}): Error | ArgumentState {
  if (index >= tokens.length) return state
  const token = tokens[index]
  if (!token) return state

  if (!token.startsWith("--")) {
    return collectArguments({
      tokens,
      index: index + 1,
      state: { ...state, positionals: [...state.positionals, token] },
    })
  }

  const name = token.slice(2)
  if (!["title", "blurb", "tags", "url"].includes(name)) {
    return new CliInputError({ message: `Unknown option --${name}` })
  }
  const value = tokens[index + 1]
  if (!value || value.startsWith("--")) {
    return new CliInputError({ message: `Missing value for --${name}` })
  }
  return collectArguments({
    tokens,
    index: index + 2,
    state: { ...state, options: { ...state.options, [name]: value } },
  })
}

function parseArgumentTokens(tokens: string[]) {
  const state = collectArguments({
    tokens,
    index: 0,
    state: { positionals: [], options: {} },
  })
  if (state instanceof Error) return state

  const [command, file] = state.positionals
  const input = {
    command,
    file,
    title: state.options.title,
    blurb: state.options.blurb,
    tags:
      state.options.tags
        ?.split(",")
        .map((tag) => tag.trim())
        .filter(Boolean) ?? [],
    url: state.options.url ?? process.env.ASSET_BOX_URL,
    serviceToken: process.env.ASSET_BOX_SERVICE_TOKEN,
  }
  const parsed = UploadArgumentsSchema.safeParse(input)
  if (parsed.success) return parsed.data
  return new CliInputError({
    message: parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; "),
  })
}

async function upload(args: z.infer<typeof UploadArgumentsSchema>) {
  const absoluteFile = path.resolve(args.file)
  const html = await fs.promises
    .readFile(absoluteFile)
    .catch((cause) => new CliFileError({ file: absoluteFile, cause }))
  if (html instanceof Error) return html

  const form = new FormData()
  form.set("html", new File([html], path.basename(absoluteFile), { type: "text/html" }))
  form.set("title", args.title)
  form.set("blurb", args.blurb)
  form.set("tags", JSON.stringify(args.tags))

  const endpoint = new URL("/api/assets", args.url)
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.serviceToken}` },
    body: form,
  }).catch((cause) => new CliRequestError({ message: "Upload request failed", cause }))
  if (response instanceof Error) return response

  const payload = await response
    .json()
    .catch((cause) => new CliRequestError({ message: "Upload response was not JSON", cause }))
  if (payload instanceof Error) return payload

  if (!response.ok) {
    const apiError = ApiErrorSchema.safeParse(payload)
    if (apiError.success) return new CliRequestError({ message: apiError.data.error.message })
    return new CliRequestError({ message: `Upload returned HTTP ${response.status}` })
  }

  const result = UploadResponseSchema.safeParse(payload)
  if (!result.success)
    return new CliRequestError({ message: "Upload response had an unexpected shape" })
  return result.data
}

function usage() {
  return [
    "Usage:",
    "  ASSET_BOX_URL=https://box.example.com ASSET_BOX_SERVICE_TOKEN=abx_... \\",
    '    bun run asset-box upload ./asset.html --title "Title" --blurb "Short description" --tags demo,landing-page',
  ].join("\n")
}

const args = parseArgumentTokens(process.argv.slice(2))
if (args instanceof Error) {
  console.error(args.message)
  console.error(usage())
  process.exit(1)
}

const result = await upload(args)
if (result instanceof Error) {
  console.error(result.message)
  process.exit(1)
}

console.log(`${result.status === "created" ? "Uploaded" : "Already exists"}: ${result.asset.title}`)
console.log(`${args.url.replace(/\/$/, "")}/view/${result.asset.id}`)
