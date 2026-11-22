"use client";

import { useEffect } from "react";

/**
 * The last safety net: what shows when the root layout itself fails (the app shell, the ticker, a provider), which `error.tsx` sits
 * inside and so can't catch. It replaces the whole document, so it brings its own <html>, <body> and styles - the app's stylesheet,
 * theme and components are exactly what may have broken, so it uses none of them. It follows the OS colour scheme.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    // Only the console: the activity log goes through the same app code that may have just failed.
    console.error("MarketDesk crashed:", error.digest ?? "", error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Something went wrong - MarketDesk</title>
        <style>{`
          :root { color-scheme: light dark; --bg: #f7f5fb; --fg: #18141f; --muted: #5c5668; --card: #ffffff; --line: #e2dcef; --accent: #5243d3; }
          @media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --fg: #f5f5f5; --muted: #b0b0b0; --card: #141416; --line: #2e2e30; --accent: #6a5cf0; } }
          * { box-sizing: border-box; }
          body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 24px; background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.5; }
          main { width: 100%; max-width: 28rem; padding: 32px 24px; text-align: center; background: var(--card); border: 1px solid var(--line); border-radius: 16px; }
          h1 { margin: 0 0 8px; font-size: 1.25rem; font-weight: 600; }
          p { margin: 0 0 24px; color: var(--muted); font-size: 0.875rem; }
          .actions { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
          button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 20px; border: 0; border-radius: 10px; background: var(--accent); color: #fff; font: inherit; font-size: 0.875rem; font-weight: 500; cursor: pointer; }
          button.secondary { border: 1px solid var(--line); background: transparent; color: var(--fg); }
          button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        `}</style>
      </head>
      <body>
        <main role="alert">
          <h1>Something went wrong</h1>
          <p>MarketDesk hit an unexpected problem and couldn&apos;t show this page. Your data is safe. Try again, or reload the page.</p>
          <div className="actions">
            <button type="button" onClick={() => retry()}>
              Try again
            </button>
            {/* A full reload, not a client-side retry: the router and the layout are what may have failed. */}
            <button type="button" className="secondary" onClick={() => window.location.reload()}>
              Reload app
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
