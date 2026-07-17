import { useQuery } from "@tanstack/react-query"
import { lazy, Suspense } from "react"
import { api, expectApiValue } from "@/client/lib/api"

const LoginScreen = lazy(() =>
  import("@/client/features/auth/components/login-screen").then((module) => ({
    default: module.LoginScreen,
  })),
)
const LibraryScreen = lazy(() =>
  import("@/client/features/library/components/library-screen").then((module) => ({
    default: module.LibraryScreen,
  })),
)

export const sessionQueryKey = ["asset-box", "session"] as const

export function App() {
  const session = useQuery({
    queryKey: sessionQueryKey,
    queryFn: async () => expectApiValue(await api.session()),
    staleTime: 60_000,
  })

  if (session.isPending) {
    return (
      <main className="grid min-h-dvh place-items-center bg-background text-sm text-muted-foreground">
        Opening Asset Box…
      </main>
    )
  }

  if (session.isError) {
    return (
      <main className="grid min-h-dvh place-items-center bg-background p-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">Asset Box is unavailable</h1>
          <p className="mt-1 text-sm text-muted-foreground">{session.error.message}</p>
        </div>
      </main>
    )
  }

  return (
    <Suspense fallback={<ScreenFallback />}>
      {session.data.authenticated ? <LibraryScreen /> : <LoginScreen />}
    </Suspense>
  )
}

function ScreenFallback() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background text-sm text-muted-foreground">
      Opening Asset Box…
    </main>
  )
}
