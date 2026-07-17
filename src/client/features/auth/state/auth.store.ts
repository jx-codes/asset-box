import { observable } from "@legendapp/state"

export type LoginState =
  | { tag: "ready"; password: string }
  | { tag: "submitting"; password: string }
  | { tag: "failed"; password: string; message: string }

export const auth$ = observable({
  login: { tag: "ready", password: "" } as LoginState,
})
