// apps/web/middleware.ts
import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isAppRoute =
    path === "/" ||
    path.startsWith("/p/") ||
    path.startsWith("/c/") ||
    path.startsWith("/settings")
  const isAuthRoute = path.startsWith("/login") || path.startsWith("/sign-up")
  const isLoginSuccessRoute =
    path === "/login" && request.nextUrl.searchParams.get("auth") === "success"
  const isSessionReplacementRoute =
    isAuthRoute &&
    request.nextUrl.searchParams.get("error") ===
      "session_replacement_required"
  const isInvitationAuthRoute =
    isAuthRoute && request.nextUrl.searchParams.get("invitation") === "pending"

  if (isAppRoute && !user) {
    const url = new URL("/login", request.url)
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  if (
    isAuthRoute &&
    user &&
    !isLoginSuccessRoute &&
    !isSessionReplacementRoute &&
    !isInvitationAuthRoute
  ) {
    const url = new URL("/", request.url)
    url.pathname = "/"
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
