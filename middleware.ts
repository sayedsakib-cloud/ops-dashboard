import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public paths: NextAuth endpoints, the cron warmer, and the login page itself.
  // Exempting /login is essential -- otherwise an unauthenticated user gets
  // redirected to /login which redirects to /login ... (loop).
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/cache-warm") ||
    pathname === "/login"
  ) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Gate the root dashboard and all app/api routes. Static assets and _next are
  // excluded by the negative lookahead so the login page's logo/CSS still load.
  matcher: [
    "/",
    "/dashboard/:path*",
    "/api/:path*",
  ],
};
