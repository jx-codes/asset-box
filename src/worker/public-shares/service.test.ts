import { describe, expect, it } from "vitest"
import { downloadPublicShare, openPublicShare } from "./service"

const token = `abp_${"a".repeat(43)}`
const assetId = "a".repeat(64)
const shareId = "9a232244-4e6b-4592-ad15-6ca4e2a0e45f"
const now = new Date("2026-07-18T10:00:00.000Z")

function fakeEnv({ accessAllowed = true }: { accessAllowed?: boolean } = {}) {
  const events: string[] = []
  const db = {
    prepare: (sql: string) => {
      const statement = {
        bind: () => statement,
        first: async () => {
          if (sql.includes("FROM public_shares share")) {
            events.push("lookup")
            return {
              share_id: shareId,
              asset_id: assetId,
              title: "Shared asset",
              blurb: "Public preview",
              object_key: `assets/${assetId}.html`,
            }
          }
          events.push("record")
          return accessAllowed ? { id: shareId } : null
        },
      }
      return statement
    },
  } as unknown as D1Database
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("<!doctype html><html></html>"))
      controller.close()
    },
  })
  const bucket = {
    head: async () => {
      events.push("head")
      return { customMetadata: {} }
    },
    get: async () => {
      events.push("read")
      return { body }
    },
  } as unknown as R2Bucket

  return {
    env: { ASSET_BOX_DB: db, ASSET_BOX_BUCKET: bucket } as WorkerEnv,
    events,
  }
}

type WorkerEnv = Parameters<typeof openPublicShare>[0]["env"]

describe("public share service", () => {
  it("verifies storage and records the view before opening the landing page", async () => {
    const { env, events } = fakeEnv()

    const result = await openPublicShare({ env, token, now })

    expect(result).toMatchObject({ tag: "opened", target: { share_id: shareId } })
    expect(events).toEqual(["lookup", "head", "record"])
  })

  it("reads bytes then durably records a download before returning them", async () => {
    const { env, events } = fakeEnv()

    const result = await downloadPublicShare({ env, token, now })

    expect(result).toMatchObject({ tag: "download", target: { asset_id: assetId } })
    expect(events).toEqual(["lookup", "read", "record"])
  })

  it("does not release downloaded bytes when revocation wins the access-recording race", async () => {
    const { env, events } = fakeEnv({ accessAllowed: false })

    const result = await downloadPublicShare({ env, token, now })

    expect(result).toBeInstanceOf(Error)
    expect(result).toMatchObject({ _tag: "PublicShareUnavailableError" })
    expect(events).toEqual(["lookup", "read", "record"])
  })
})
