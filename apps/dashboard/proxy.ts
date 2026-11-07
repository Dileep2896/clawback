import { type NextRequest, NextResponse } from "next/server";
import { isPublicPath, readSession, SESSION_COOKIE, sessionSecret } from "./lib/auth.ts";

/** Every page and API needs a signed session except the public ones. Pages redirect to log in; APIs answer 401. */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (readSession(request.cookies.get(SESSION_COOKIE)?.value, sessionSecret())) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Log in first" }, { status: 401 });
  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}
