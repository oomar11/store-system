import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function withSupabaseCookies(
  from: NextResponse,
  to: NextResponse
): NextResponse {
  from.cookies.getAll().forEach(({ name, value, ...rest }) => {
    to.cookies.set(name, value, rest);
  });
  return to;
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isRoot = pathname === "/" || pathname === "";
  const isLogin = pathname.startsWith("/login");
  const isAuthCallback = pathname.startsWith("/auth");
  const isPublicAsset =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/icons") ||
    pathname.startsWith("/serwist") ||
    pathname === "/sw.js" ||
    pathname === "/manifest.json" ||
    pathname === "/offline.html" ||
    pathname === "/app-start.html" ||
    pathname === "/~offline" ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.png";

  if (isPublicAsset || isAuthCallback) {
    return supabaseResponse;
  }

  // Cron and backup APIs have their own auth (CRON_SECRET / requireOwner)
  if (pathname.startsWith("/api/")) {
    return supabaseResponse;
  }

  const hasSessionCookie = request.cookies
    .getAll()
    .some(
      (c) =>
        c.name.includes("-auth-token") ||
        (c.name.startsWith("sb-") && c.name.includes("auth"))
    );

  // Offline / Auth unreachable: allow through whenever a session cookie exists
  if (!user && hasSessionCookie && !isLogin) {
    // Rewrite `/` so the SW never sees a bare 307 on the root URL
    if (isRoot) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", "/dashboard");
      return withSupabaseCookies(supabaseResponse, NextResponse.rewrite(url));
    }
    return supabaseResponse;
  }

  if (!user && !isLogin) {
    // Rewrite `/` (200) instead of redirect (307) — SW + Chrome treat
    // navigation redirects on `/` as net::ERR_FAILED.
    if (isRoot) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", "/dashboard");
      return withSupabaseCookies(supabaseResponse, NextResponse.rewrite(url));
    }
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return withSupabaseCookies(supabaseResponse, NextResponse.redirect(url));
  }

  if (user && isLogin) {
    const next = request.nextUrl.searchParams.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) {
      return withSupabaseCookies(
        supabaseResponse,
        NextResponse.redirect(new URL(next, request.url))
      );
    }
    return withSupabaseCookies(
      supabaseResponse,
      NextResponse.redirect(new URL("/dashboard", request.url))
    );
  }

  // Logged-in users hitting `/` → dashboard (rewrite = 200, SW-safe)
  if (user && isRoot) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return withSupabaseCookies(supabaseResponse, NextResponse.rewrite(url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
