/**
 * Resolves the app's public base URL for absolute links (OG tags, sitemap,
 * robots). Vercel injects VERCEL_* at build/runtime with no scheme, so those
 * take priority over localhost once deployed; NEXT_PUBLIC_SITE_URL lets you
 * pin it explicitly once a custom domain is attached.
 */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;

  return "http://localhost:3000";
}
