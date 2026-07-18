import { ServiceTokenSecretSchema } from "@/shared/domain"
import { createCapabilityTokenMaterial, hashCapabilityToken } from "./capability-token"

export function isServiceToken(value: string) {
  return ServiceTokenSecretSchema.safeParse(value).success
}

export function hashServiceToken(token: string) {
  return hashCapabilityToken({ token, operation: "service token hashing" })
}

export function createServiceTokenMaterial({
  randomBytes,
}: {
  randomBytes?: () => Uint8Array
} = {}) {
  return createCapabilityTokenMaterial({
    tokenPrefix: "abx_",
    operation: "service token random generation",
    ...(randomBytes === undefined ? {} : { randomBytes }),
  })
}
