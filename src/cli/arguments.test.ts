import { describe, expect, it } from "vitest"
import { parseArgumentTokens } from "./arguments"

const env = {
  ASSET_BOX_URL: "https://asset-box.example.com",
  ASSET_BOX_SERVICE_TOKEN: `abx_${"a".repeat(43)}`,
}

describe("Asset Box CLI arguments", () => {
  it("parses pull with an optional request and bounded lease", () => {
    const result = parseArgumentTokens(
      [
        "pull",
        "9a232244-4e6b-4592-ad15-6ca4e2a0e45f",
        "--out",
        "./work",
        "--lease-seconds",
        "1200",
      ],
      env,
    )

    expect(result).toEqual({
      command: "pull",
      requestId: "9a232244-4e6b-4592-ad15-6ca4e2a0e45f",
      out: "./work",
      leaseSeconds: 1200,
      url: env.ASSET_BOX_URL,
      serviceToken: env.ASSET_BOX_SERVICE_TOKEN,
    })
  })

  it("parses push with a stable workspace and full result metadata", () => {
    const result = parseArgumentTokens(
      [
        "push",
        "./work",
        "--html",
        "final.html",
        "--title",
        "Updated diagram",
        "--blurb",
        "Higher contrast architecture diagram",
        "--tags",
        "diagram,architecture",
      ],
      env,
    )

    expect(result).toMatchObject({
      command: "push",
      directory: "./work",
      html: "final.html",
      title: "Updated diagram",
      tags: ["diagram", "architecture"],
    })
  })

  it("rejects missing and malformed credentials before requests", () => {
    expect(parseArgumentTokens(["pull"], { ASSET_BOX_URL: env.ASSET_BOX_URL })).toBeInstanceOf(
      Error,
    )
    expect(
      parseArgumentTokens(["pull"], {
        ASSET_BOX_URL: env.ASSET_BOX_URL,
        ASSET_BOX_SERVICE_TOKEN: "revoked-shape",
      }),
    ).toBeInstanceOf(Error)
  })
})
