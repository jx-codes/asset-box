import * as errore from "errore"
import type { Context } from "hono"
import { getCookie } from "hono/cookie"
import { authenticateServiceTokenHash } from "../data/service-token-repository"
import type { Env } from "../env"
import {
  AuthRequiredError,
  InternalFailureError,
  InvalidCredentialsError,
  LoginThrottledError,
} from "../errors"
import { AttemptResultSchema } from "../coordinator"
import { verifySessionToken } from "./session"
import { hashServiceToken, isServiceToken } from "./service-token"

const BEARER_PREFIX = "Bearer "

async function secretMatches({ candidate, expected }: { candidate: string; expected: string }) {
  const [candidateHash, expectedHash] = await Promise.all([
    crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(candidate))
      .catch((cause) => new InternalFailureError({ operation: "credential hashing", cause })),
    crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(expected))
      .catch((cause) => new InternalFailureError({ operation: "credential hashing", cause })),
  ])
  if (candidateHash instanceof Error) return candidateHash
  if (expectedHash instanceof Error) return expectedHash

  const candidateBytes = new Uint8Array(candidateHash)
  const expectedBytes = new Uint8Array(expectedHash)
  const difference = candidateBytes.reduce(
    (current, byte, index) => current | (byte ^ expectedBytes[index]),
    0,
  )
  return difference === 0
}

function clientAddress(c: Context<{ Bindings: Env }>) {
  return c.req.header("CF-Connecting-IP") ?? "local-development"
}

export async function checkPasswordAttempt({
  c,
  password,
}: {
  c: Context<{ Bindings: Env }>
  password: string
}) {
  const valid = await secretMatches({ candidate: password, expected: c.env.ASSET_BOX_PASSWORD })
  if (valid instanceof Error) return valid

  const id = c.env.COORDINATOR.idFromName(`auth:${clientAddress(c)}`)
  const response = await c.env.COORDINATOR.get(id)
    .fetch("https://coordinator/auth-attempt", {
      method: "POST",
      body: JSON.stringify({ valid, now: Date.now() }),
    })
    .catch((cause) => new InternalFailureError({ operation: "login throttle", cause }))
  if (response instanceof Error) return response

  const payload = await response
    .json()
    .catch((cause) => new InternalFailureError({ operation: "login throttle response", cause }))
  if (payload instanceof Error) return payload

  const attempt = errore.try({
    try: () => AttemptResultSchema.parse(payload),
    catch: (cause) =>
      new InternalFailureError({ operation: "login throttle response parsing", cause }),
  })
  if (attempt instanceof Error) return attempt
  if (attempt.tag === "blocked") {
    return new LoginThrottledError({ retryAfterSeconds: attempt.retryAfterSeconds })
  }
  if (!valid) return new InvalidCredentialsError()
  return { tag: "authenticated" as const }
}

export async function authorizeBrowserSession(c: Context<{ Bindings: Env }>) {
  const token = getCookie(c, "asset_box_session")
  if (!token) return new AuthRequiredError()

  const verified = await verifySessionToken({
    token,
    secret: c.env.SESSION_SECRET,
    now: new Date(),
  })
  if (verified instanceof Error) return verified
  if (!verified) return new AuthRequiredError()
  return { tag: "browser-session" as const }
}

async function authorizeServiceToken({
  c,
  token,
}: {
  c: Context<{ Bindings: Env }>
  token: string
}) {
  if (!isServiceToken(token)) return new AuthRequiredError()
  const tokenHash = await hashServiceToken(token)
  if (tokenHash instanceof Error) return tokenHash

  const authenticated = await authenticateServiceTokenHash({
    db: c.env.ASSET_BOX_DB,
    tokenHash,
    now: new Date(),
  })
  if (authenticated instanceof Error) return authenticated
  if (authenticated.tag === "missing") return new AuthRequiredError()
  return { tag: "service-token" as const, tokenId: authenticated.value.id }
}

export async function authorize(c: Context<{ Bindings: Env }>) {
  const authorization = c.req.header("Authorization")
  if (!authorization) return authorizeBrowserSession(c)
  if (!authorization.startsWith(BEARER_PREFIX)) return new AuthRequiredError()

  return authorizeServiceToken({ c, token: authorization.slice(BEARER_PREFIX.length) })
}
