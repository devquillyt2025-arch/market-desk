/**
 * Site icons for the Important Links tab: `GET /api/logo?host=nseindia.com` answers with the icon, or a 404 when no
 * service has one.
 *
 * Why this is a route and not an <img> pointed straight at a favicon service: a browser decodes an <img> body whatever
 * the HTTP status, and these services answer "unknown site" with a 404 *carrying a generic globe image* - so
 * from the page, "no icon" and "an icon" look the same and a made-up site would get a globe. Asking from the
 * server, the status can be read and a miss can be a real 404 that lets the card keep its monogram. It also means
 * the services see this server, not your browser: no IP address, no referrer. Only the host is ever sent (never a path),
 * and only for a public domain name (isPublicHost). FETCH_LOGOS in linkMeta.ts switches the whole thing off.
 *
 * Behind the app's PIN like every other /api route (proxy.ts). Answers are kept in memory for a day (a miss) or a week
 * (a hit), so a host is looked up once however many devices and visits ask, and the browser is told to keep them too.
 */

import { isPublicHost, logoSourcesFor } from "@/app/links/linkMeta";

const HIT_TTL_MS = 7 * 24 * 3_600_000;
const MISS_TTL_MS = 24 * 3_600_000;
const MAX_CACHE_ENTRIES = 300;
const MAX_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 6000;

/** Raster icon types only - never SVG or HTML, which a browser could run if the response were opened directly. */
const ALLOWED_TYPES = ["image/png", "image/x-icon", "image/vnd.microsoft.icon", "image/jpeg", "image/gif", "image/webp"];

type Cached = { at: number; icon: { bytes: ArrayBuffer; type: string } | null };
const cache = new Map<string, Cached>();

function remember(host: string, icon: Cached["icon"]) {
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string); // oldest first
  cache.set(host, { at: Date.now(), icon });
}

async function lookup(host: string): Promise<Cached["icon"]> {
  for (const source of logoSourcesFor(host)) {
    try {
      const response = await fetch(source, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: "image/*" } });
      const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!response.ok || !ALLOWED_TYPES.includes(type)) continue;
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) continue;
      return { bytes, type };
    } catch {
      // This service was unreachable or too slow - the next one may do better.
    }
  }
  return null;
}

export async function GET(request: Request) {
  const host = (new URL(request.url).searchParams.get("host") ?? "").trim().toLowerCase();
  if (!isPublicHost(host)) return new Response(null, { status: 400 });

  let entry = cache.get(host);
  if (!entry || Date.now() - entry.at > (entry.icon ? HIT_TTL_MS : MISS_TTL_MS)) {
    const icon = await lookup(host);
    remember(host, icon);
    entry = { at: Date.now(), icon };
  }

  if (!entry.icon) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "private, max-age=86400" } });
  }
  return new Response(entry.icon.bytes, {
    headers: {
      "Content-Type": entry.icon.type,
      "Cache-Control": "private, max-age=604800",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
