import { auth$ } from "./auth.store"

export function changePassword(password: string) {
  auth$.login.set({ tag: "ready", password })
}

export function startLogin() {
  const state = auth$.login.peek()
  if (state.tag === "submitting") return
  auth$.login.set({ tag: "submitting", password: state.password })
}

export function failLogin(message: string) {
  const state = auth$.login.peek()
  auth$.login.set({ tag: "failed", password: state.password, message })
}

export function resetLogin() {
  auth$.login.set({ tag: "ready", password: "" })
}
