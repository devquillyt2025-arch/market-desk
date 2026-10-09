import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { AUTH_COOKIE, verifySession } from "@/lib/pinAuth";

/** Reachable while locked: the PIN screen itself, plus metadata files the browser and link previews fetch without cookies. */
const PUBLIC_PATHS = [
  "/lock",
  "/icon",
  "/apple-icon",
  "/opengraph-image",
  "/manifest.webmanifest",
  "/robots.txt",
  "/sitemap.xml",
];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  if (verifySession(request.cookies.get(AUTH_COOKIE)?.value)) {
    return NextResponse.next();
  }

  // The Upstox routes hand back live broker data, so they get a plain 401 rather than a redirect to an HTML page.
  if (pathname.startsWith("/api/")) {
    return Response.json({ error: "Locked — enter your PIN first." }, { status: 401 });
  }

  const lockUrl = new URL("/lock", request.nextUrl);
  lockUrl.searchParams.set("next", pathname + search);
  return NextResponse.redirect(lockUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
