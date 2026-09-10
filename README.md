# MarketDesk

Multi-leg options-selling P&L calculator for Nifty, Bank Nifty, and Sensex.

## Stack

Next.js (App Router) + TypeScript + Tailwind. All data — trades, links,
activity logs — lives in the browser's `localStorage`; there's no backend
required to run this. A Supabase schema is included under `supabase/` for
wiring up real persistence later (see below).

## Routes

- `/` — the trade calculator (pure client-side math, works with no setup)
- `/history` — saved trades, newest first, with delete/clear
- `/links` — a customizable list of reference links (add/remove your own)
- `/logs` — an activity log of every change made in the app

## Architecture

- `src/lib/calculateTrade.ts` — pure P&L math (`calculateTrade(legs, qty)`), no
  React or storage dependency. This is what a future bulk analyser/backtester
  will call per historical trade.
- `src/lib/types.ts` — domain types (`Instrument`, `Trade`, `TradeLeg`) shared
  across the app, shaped to match the Supabase schema below so swapping in a
  real backend later doesn't require changing these types.
- `src/lib/tradeStore.ts`, `linksStore.ts`, `activityLog.ts` — localStorage-backed
  persistence, each with an async API (`getX`/`saveX`/`deleteX`) shaped like
  the eventual server calls would be, so the storage layer can be swapped
  without touching call sites.
- `src/lib/supabase/{client,server,env}.ts` — a typed Supabase client, unused
  by the app today but ready to wire in once a real backend is needed.
- `src/components/Sidebar.tsx` — left-nav layout (desktop sidebar, mobile
  drawer) with the theme toggle.

## Setup

```bash
npm install && npm run dev
```

Then open http://localhost:3000 — no environment variables or database needed.

### Optional: wiring up Supabase

A schema is included under `supabase/migrations/` for if/when this needs real
multi-device persistence instead of per-browser `localStorage`:

1. Create a project at [supabase.com](https://supabase.com).
2. Run the migration — paste `supabase/migrations/20260910000000_init.sql`
   into the Supabase SQL editor, or with the CLI:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
3. Copy `.env.local.example` to `.env.local` and fill in your project's URL
   and anon key (Project Settings → API in the Supabase dashboard).
4. Point `tradeStore.ts` (etc.) at `src/lib/supabase/client.ts` instead of
   `localStorage`.

## Deploying

This is a standard Next.js app — deploy to Vercel with no configuration and no
environment variables required.

## Notes

- Postgres `numeric` columns come back from PostgREST as strings, not JS
  numbers — worth remembering if/when `tradeStore.ts` is swapped to call
  Supabase directly.
- RLS is deliberately not enabled in the migration — there's no auth to scope
  it to yet. When auth lands, add `user_id`-scoped policies rather than an
  anon allow-all.
