import type { MetadataRoute } from "next";

/**
 * What the phone reads when MarketDesk is added to its home screen: it opens straight on Live Portfolio, as its own full-screen
 * app (no browser address bar), with the violet tile as its icon and a long-press menu for the pages checked most. The icons
 * are generated (see icon.tsx) and are served without the PIN, which the browser needs to fetch them.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "MarketDesk",
    short_name: "MarketDesk",
    description: "Multi-leg options-selling P&L calculator for Nifty, Bank Nifty, and Sensex.",
    start_url: "/portfolio",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#7869fc",
    categories: ["finance", "business"],
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
    shortcuts: [
      { name: "Live Portfolio", short_name: "Portfolio", url: "/portfolio" },
      { name: "Watchlist", url: "/watchlist" },
      { name: "Reports", url: "/reports" },
    ],
  };
}
