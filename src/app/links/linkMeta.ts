/**
 * Pure helpers behind the Important Links tab - no React, no fetching. Kept apart
 * from the components so the bits that decide what the page shows (which links a
 * search keeps, what colour a group gets, how a bare "nseindia.com" becomes a
 * URL) can be tested on their own.
 */

import type { LinkItem } from "@/lib/linksStore";

/**
 * The colours a group can take. They are references into the app's theme tokens,
 * not hex values, so each one is already tuned for the light and the dark palette
 * - a card tinted with `color-mix(... var(--tone) ...)` reads in both.
 */
export const GROUP_TONES = ["var(--accent)", "var(--accent-soft)", "var(--info)", "var(--success)", "var(--warning)"] as const;
export type GroupTone = (typeof GROUP_TONES)[number];

/** The built-in groups keep a colour of their own, so the page looks the same for everyone who has them. */
const FIXED_TONES: Record<string, GroupTone> = {
  "Market Data": "var(--accent)",
  "Exchange & Regulatory": "var(--info)",
};

/** A group's colour: fixed for the built-ins, otherwise picked from its name - so it never changes between visits or devices. */
export function toneForGroup(group: string): GroupTone {
  const key = group.trim();
  const fixed = FIXED_TONES[key];
  if (fixed) return fixed;
  let hash = 0;
  for (const ch of key.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return GROUP_TONES[hash % GROUP_TONES.length];
}

/** Accepts "nseindia.com" as well as a full URL; null when it can't be made into one. */
export function normalizeUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}

/** "www.nseindia.com" for https://www.nseindia.com/option-chain → "nseindia.com". Falls back to the text as typed. */
export function hostOf(url: string): string {
  const stripWww = (host: string) => host.replace(/^www\./i, "");
  const withScheme = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
  try {
    return stripWww(new URL(withScheme).hostname);
  } catch {
    return stripWww(url.trim().replace(/^https?:\/\//i, "").split(/[/?#]/)[0] ?? "");
  }
}

/**
 * Master switch for logo lookups. Turn it off and every card keeps its monogram tile, and nothing about your links
 * is sent anywhere. While it is on, the *host* of each link (never the path) is sent to a favicon service so
 * the browser can fetch the site's icon - see logoSourcesFor.
 */
export const FETCH_LOGOS = true;

/**
 * A host worth asking a favicon service about: a real public domain name. Not an address on your own
 * network (`localhost`, `192.168.1.5`, `router.local`), and not something half-typed - names like
 * those are neither findable nor something to broadcast.
 */
export function isPublicHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) return false;
  const labels = h.split(".");
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/.test(tld) && !tld.startsWith("xn--")) return false; // rules out IP addresses
  return !["local", "localhost", "internal", "lan", "home", "corp", "intranet", "test", "example", "invalid"].includes(tld);
}

/** The page's address for a site's icon (answered by /api/logo), or null when the host shouldn't be looked up. */
export function logoUrlFor(host: string): string | null {
  if (!FETCH_LOGOS || !isPublicHost(host)) return null;
  return `/api/logo?host=${encodeURIComponent(host.trim().toLowerCase())}`;
}

/**
 * Where /api/logo looks for a site's icon, best first; empty when the host shouldn't be looked up at all. Google's
 * service returns up to 64px and covers most sites; DuckDuckGo's catches some it misses. Both answer a site
 * they don't know with a 404 - which only the server can see (see the route for why).
 */
export function logoSourcesFor(host: string): string[] {
  if (!FETCH_LOGOS || !isPublicHost(host)) return [];
  const h = host.trim().toLowerCase();
  return [
    `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(`https://${h}`)}&size=64`,
    `https://icons.duckduckgo.com/ip3/${h}.ico`,
  ];
}

/** How big to draw an icon of `naturalWidth` pixels inside the tile: no bigger than the image really is, so a 16px favicon isn't smeared across 28. */
export function logoDisplaySize(naturalWidth: number): number {
  return Math.min(28, Math.max(20, Math.round(naturalWidth)));
}

/** Two letters for the monogram tile: first letters of the first two words, or the first two letters of a single word. */
export function initialsOf(label: string): string {
  const words = label
    .trim()
    .split(/[\s\-_/&.]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const letters =
    words.length === 1 ? Array.from(words[0]).slice(0, 2) : [Array.from(words[0])[0], Array.from(words[1])[0]];
  return letters.join("").toUpperCase();
}

/** Every word typed must appear somewhere in the link's name, note, site or group - in any order, any case. */
export function matchesQuery(link: Pick<LinkItem, "label" | "description" | "url" | "group">, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = `${link.label} ${link.description ?? ""} ${hostOf(link.url)} ${link.group}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** The fields of the add / edit popup. */
export type LinkFormValues = {
  label: string;
  url: string;
  description: string;
  group: string;
};

/**
 * Whether the popup holds something typed that closing would lose. Spaces alone don't count - a stray space is not
 * work worth protecting - so only a real difference from what the popup opened with does.
 */
export function isFormDirty(current: LinkFormValues, baseline: LinkFormValues): boolean {
  return (["label", "url", "description", "group"] as const).some((key) => current[key].trim() !== baseline[key].trim());
}

/** Custom groups first, the built-in ones (see NECESSARY_LINK_GROUPS) last - the order the page has always used. */
export function orderGroupNames(names: string[], builtIn: readonly string[]): string[] {
  return [...names.filter((g) => !builtIn.includes(g)), ...names.filter((g) => builtIn.includes(g))];
}
