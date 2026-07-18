import * as errore from "errore"
import type { ApiErrorCode, ApiErrorPayload } from "@/shared/domain"

export class AuthRequiredError extends errore.createTaggedError({
  name: "AuthRequiredError",
  message: "Authentication is required",
}) {}

export class InvalidCredentialsError extends errore.createTaggedError({
  name: "InvalidCredentialsError",
  message: "The password is not valid",
}) {}

export class LoginThrottledError extends errore.createTaggedError({
  name: "LoginThrottledError",
  message: "Too many password attempts. Try again in $retryAfterSeconds seconds",
}) {}

export class InvalidInputError extends errore.createTaggedError({
  name: "InvalidInputError",
  message: "$reason",
}) {}

export class AssetNotFoundError extends errore.createTaggedError({
  name: "AssetNotFoundError",
  message: "Asset $id was not found",
}) {}

export class AssetDeletePendingError extends errore.createTaggedError({
  name: "AssetDeletePendingError",
  message: "Asset $id is waiting for storage cleanup; retry its delete request",
}) {}

export class ServiceTokenNotFoundError extends errore.createTaggedError({
  name: "ServiceTokenNotFoundError",
  message: "Service token $id was not found",
}) {}

export class TagNotFoundError extends errore.createTaggedError({
  name: "TagNotFoundError",
  message: "Tag $id was not found",
}) {}

export class TagConflictError extends errore.createTaggedError({
  name: "TagConflictError",
  message: "A tag with the slug $slug already exists",
}) {}

export class UnknownTagError extends errore.createTaggedError({
  name: "UnknownTagError",
  message: "Tag $slug does not exist",
}) {}

export class StorageFailureError extends errore.createTaggedError({
  name: "StorageFailureError",
  message: "Asset storage failed during $operation",
}) {}

export class DatabaseFailureError extends errore.createTaggedError({
  name: "DatabaseFailureError",
  message: "Metadata storage failed during $operation",
}) {}

export class InternalFailureError extends errore.createTaggedError({
  name: "InternalFailureError",
  message: "Asset Box failed during $operation",
}) {}

type ErrorResponse = {
  body: ApiErrorPayload
  status: 400 | 401 | 404 | 409 | 429 | 500
  headers?: Record<string, string>
}

function response({
  code,
  message,
  status,
  retryAfterSeconds,
}: {
  code: ApiErrorCode
  message: string
  status: ErrorResponse["status"]
  retryAfterSeconds?: number
}): ErrorResponse {
  return {
    status,
    body: {
      error: {
        code,
        message,
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      },
    },
    ...(retryAfterSeconds === undefined
      ? {}
      : { headers: { "Retry-After": String(retryAfterSeconds) } }),
  }
}

export function toErrorResponse(error: Error): ErrorResponse {
  if (AuthRequiredError.is(error)) {
    return response({ code: "AUTH_REQUIRED", message: error.message, status: 401 })
  }
  if (InvalidCredentialsError.is(error)) {
    return response({ code: "INVALID_CREDENTIALS", message: error.message, status: 401 })
  }
  if (LoginThrottledError.is(error)) {
    return response({
      code: "LOGIN_THROTTLED",
      message: error.message,
      status: 429,
      retryAfterSeconds: Number(error.retryAfterSeconds),
    })
  }
  if (InvalidInputError.is(error)) {
    return response({ code: "INVALID_INPUT", message: error.message, status: 400 })
  }
  if (AssetNotFoundError.is(error)) {
    return response({ code: "ASSET_NOT_FOUND", message: error.message, status: 404 })
  }
  if (AssetDeletePendingError.is(error)) {
    return response({ code: "ASSET_DELETE_PENDING", message: error.message, status: 409 })
  }
  if (ServiceTokenNotFoundError.is(error)) {
    return response({ code: "SERVICE_TOKEN_NOT_FOUND", message: error.message, status: 404 })
  }
  if (TagNotFoundError.is(error)) {
    return response({ code: "TAG_NOT_FOUND", message: error.message, status: 404 })
  }
  if (TagConflictError.is(error)) {
    return response({ code: "TAG_CONFLICT", message: error.message, status: 409 })
  }
  if (UnknownTagError.is(error)) {
    return response({ code: "UNKNOWN_TAG", message: error.message, status: 400 })
  }
  if (StorageFailureError.is(error)) {
    return response({ code: "STORAGE_FAILURE", message: error.message, status: 500 })
  }
  if (DatabaseFailureError.is(error)) {
    return response({ code: "DATABASE_FAILURE", message: error.message, status: 500 })
  }
  return response({
    code: "INTERNAL_FAILURE",
    message: "Asset Box could not complete the request",
    status: 500,
  })
}
