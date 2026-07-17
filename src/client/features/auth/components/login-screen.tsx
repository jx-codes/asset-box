import { useValue } from "@legendapp/state/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { FormEvent } from "react"
import { Box } from "lucide-react"
import { sessionQueryKey } from "@/client/app"
import { api, expectApiValue } from "@/client/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { changePassword, failLogin, resetLogin, startLogin } from "../state/auth.actions"
import { auth$ } from "../state/auth.store"

export function LoginScreen() {
  const login = useValue(auth$.login)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (password: string) => expectApiValue(await api.login(password)),
    onSuccess: async () => {
      resetLogin()
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey })
    },
    onError: (error) => failLogin(error.message),
  })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (login.tag === "submitting" || login.password.length === 0) return
    startLogin()
    mutation.mutate(login.password)
  }

  return (
    <main className="grid min-h-dvh bg-muted p-4 sm:place-items-center sm:p-8">
      <section className="m-auto w-full max-w-sm border bg-card p-6 shadow-[0_18px_50px_-30px_rgba(25,22,18,0.5)] sm:p-8">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-10 place-items-center bg-foreground text-background">
            <Box className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-heading text-xl font-semibold tracking-tight">Asset Box</h1>
            <p className="text-sm text-muted-foreground">Your private HTML library</p>
          </div>
        </div>

        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={login.password}
              onChange={(event) => changePassword(event.currentTarget.value)}
              disabled={login.tag === "submitting"}
            />
          </div>
          {login.tag === "failed" ? (
            <p className="text-sm text-destructive" role="alert">
              {login.message}
            </p>
          ) : null}
          <Button className="w-full" type="submit" disabled={login.tag === "submitting"}>
            {login.tag === "submitting" ? "Opening…" : "Open Asset Box"}
          </Button>
        </form>
      </section>
    </main>
  )
}
