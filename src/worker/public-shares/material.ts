import { PublicShareSecretSchema } from "@/shared/public-shares"
import { createCapabilityTokenMaterial, hashCapabilityToken } from "../auth/capability-token"

export function isPublicShareToken(value: string) {
  return PublicShareSecretSchema.safeParse(value).success
}

export function hashPublicShareToken(token: string) {
  return hashCapabilityToken({ token, operation: "public share token hashing" })
}

export function createPublicShareTokenMaterial({
  randomBytes,
}: {
  randomBytes?: () => Uint8Array
} = {}) {
  return createCapabilityTokenMaterial({
    tokenPrefix: "abp_",
    operation: "public share token random generation",
    ...(randomBytes === undefined ? {} : { randomBytes }),
  })
}
