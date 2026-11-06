// Vercel Routing Middleware. Runs ONLY for the paths in `config.matcher` below,
// so the public site (/, images, videos, scripts) never goes through it.
//  - /jarvis and /api/jarvis/* need a valid login (Justin or Tyler)
//  - /data/* (private business data used by Jarvis) is never served publicly
import { next } from "@vercel/functions";
import { readSession } from "./api/_lib/session.js";
import { loginPage } from "./api/_lib/login-page.js";

export const config = {
  matcher: ["/jarvis", "/jarvis/:path*", "/api/jarvis/:path*", "/data", "/data/:path*"],
};

const PRIVATE = { "X-Robots-Tag": "noindex, nofollow, noarchive", "Cache-Control": "no-store" };

export default async function middleware(request) {
  const { pathname } = new URL(request.url);

  if (pathname === "/data" || pathname.startsWith("/data/")) {
    return new Response("Not found", { status: 404, headers: PRIVATE });
  }

  const user = await readSession(request).catch(() => null);
  if (user) return next({ headers: PRIVATE });

  if (pathname.startsWith("/api/")) {
    return Response.json({ error: "Not logged in" }, { status: 401, headers: PRIVATE });
  }
  if (pathname === "/jarvis" || pathname === "/jarvis/" || pathname === "/jarvis/index.html") {
    return new Response(loginPage(), { status: 401, headers: { ...PRIVATE, "Content-Type": "text/html; charset=utf-8" } });
  }
  return new Response("Not found", { status: 404, headers: PRIVATE });
}
