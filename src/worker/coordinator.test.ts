import { test } from "@fast-check/vitest"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { decideAttempt } from "./coordinator"

describe("password attempt throttling", () => {
  it("blocks the fifth consecutive failed attempt for fifteen minutes", () => {
    const now = Date.parse("2026-07-17T12:00:00.000Z")
    const first = decideAttempt({
      state: { failures: 0, blockedUntil: 0 },
      input: { valid: false, now },
    })
    const second = decideAttempt({ state: first.nextState, input: { valid: false, now } })
    const third = decideAttempt({ state: second.nextState, input: { valid: false, now } })
    const fourth = decideAttempt({ state: third.nextState, input: { valid: false, now } })
    const fifth = decideAttempt({ state: fourth.nextState, input: { valid: false, now } })

    expect(first.response).toEqual({ tag: "rejected", attemptsRemaining: 4 })
    expect(fourth.response).toEqual({ tag: "rejected", attemptsRemaining: 1 })
    expect(fifth.response).toEqual({ tag: "blocked", retryAfterSeconds: 900 })
    expect(fifth.nextState.blockedUntil).toBe(now + 900_000)
  })

  it("keeps rejecting attempts while the block is active", () => {
    const result = decideAttempt({
      state: { failures: 0, blockedUntil: 10_000 },
      input: { valid: true, now: 5_500 },
    })

    expect(result.response).toEqual({ tag: "blocked", retryAfterSeconds: 5 })
  })

  test.prop([fc.integer({ min: 0, max: 4 }), fc.nat()])(
    "a valid password clears any expired failure count",
    (failures, now) => {
      const result = decideAttempt({
        state: { failures, blockedUntil: now },
        input: { valid: true, now },
      })

      expect(result).toEqual({
        response: { tag: "allowed" },
        nextState: { failures: 0, blockedUntil: 0 },
      })
    },
  )
})
