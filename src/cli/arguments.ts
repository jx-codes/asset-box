import * as errore from "errore"
import { z } from "zod"
import { ServiceTokenSecretSchema } from "@/shared/domain"
import { WorkRequestIdSchema } from "@/shared/work-requests"

export class CliInputError extends errore.createTaggedError({
  name: "CliInputError",
  message: "$message",
}) {}

const ConnectionSchema = z.object({
  url: z.url(),
  serviceToken: ServiceTokenSecretSchema,
})

export const UploadArgumentsSchema = ConnectionSchema.extend({
  command: z.literal("upload"),
  file: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  blurb: z.string().trim().min(1).max(280),
  tags: z.array(z.string()),
})

export const PullArgumentsSchema = ConnectionSchema.extend({
  command: z.literal("pull"),
  requestId: WorkRequestIdSchema.optional(),
  out: z.string().min(1),
  leaseSeconds: z.number().int().min(60).max(3600),
})

export const PushArgumentsSchema = ConnectionSchema.extend({
  command: z.literal("push"),
  directory: z.string().min(1),
  html: z.string().min(1),
  title: z.string().trim().min(1).max(120).optional(),
  blurb: z.string().trim().min(1).max(280).optional(),
  tags: z.array(z.string()),
})

export const FailArgumentsSchema = ConnectionSchema.extend({
  command: z.literal("fail"),
  directory: z.string().min(1),
  reason: z.string().trim().min(1).max(4000),
})

export const CliArgumentsSchema = z.discriminatedUnion("command", [
  UploadArgumentsSchema,
  PullArgumentsSchema,
  PushArgumentsSchema,
  FailArgumentsSchema,
])

export type CliArguments = z.infer<typeof CliArgumentsSchema>

const allowedOptions = new Set([
  "title",
  "blurb",
  "tags",
  "url",
  "out",
  "lease-seconds",
  "html",
  "reason",
])

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
}): CliInputError | ArgumentState {
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
  if (!allowedOptions.has(name)) return new CliInputError({ message: `Unknown option --${name}` })
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

function commaList(value: string | undefined) {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

function formatZodIssues(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
}

export function parseArgumentTokens(
  tokens: string[],
  env: Record<string, string | undefined> = process.env,
): CliArguments | CliInputError {
  const state = collectArguments({ tokens, index: 0, state: { positionals: [], options: {} } })
  if (state instanceof Error) return state

  const [command, first] = state.positionals
  const connection = {
    url: state.options.url ?? env.ASSET_BOX_URL,
    serviceToken: env.ASSET_BOX_SERVICE_TOKEN,
  }
  const candidate: unknown = (() => {
    if (command === "upload") {
      return {
        command,
        file: first,
        title: state.options.title,
        blurb: state.options.blurb,
        tags: commaList(state.options.tags),
        ...connection,
      }
    }
    if (command === "pull") {
      return {
        command,
        requestId: first,
        out: state.options.out ?? "asset-box-work",
        leaseSeconds: Number(state.options["lease-seconds"] ?? 900),
        ...connection,
      }
    }
    if (command === "push") {
      return {
        command,
        directory: first ?? "asset-box-work",
        html: state.options.html ?? "result.html",
        title: state.options.title,
        blurb: state.options.blurb,
        tags: commaList(state.options.tags),
        ...connection,
      }
    }
    if (command === "fail") {
      return {
        command,
        directory: first ?? "asset-box-work",
        reason: state.options.reason,
        ...connection,
      }
    }
    return { command, ...connection }
  })()

  const parsed = CliArgumentsSchema.safeParse(candidate)
  if (parsed.success) return parsed.data
  return new CliInputError({ message: formatZodIssues(parsed.error) })
}

export function usage() {
  return [
    "Usage:",
    "  ASSET_BOX_URL=https://box.example.com ASSET_BOX_SERVICE_TOKEN=abx_... \\",
    '    bun run asset-box upload ./asset.html --title "Title" --blurb "Description" --tags demo',
    "  bun run asset-box pull [request-id] --out ./asset-box-work --lease-seconds 900",
    '  bun run asset-box push ./asset-box-work --html result.html --title "Result" --blurb "Description" --tags demo',
    '  bun run asset-box fail ./asset-box-work --reason "Failure details"',
  ].join("\n")
}
