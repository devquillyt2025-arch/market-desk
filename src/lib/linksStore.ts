/**
 * Local-only persistence for the Important Links page. Seeded once with the
 * built-in reference links; from then on the full list (defaults included)
 * lives in localStorage so the user can add or remove freely.
 */

import { logEvent } from "@/lib/activityLog";

const STORAGE_KEY = "marketdesk:links";

export type LinkItem = {
  id: string;
  label: string;
  url: string;
  description?: string;
  group: string;
};

const DEFAULT_LINKS: LinkItem[] = [
  {
    id: "default-nse-option-chain",
    label: "NSE Option Chain",
    url: "https://www.nseindia.com/option-chain",
    description: "Live option chain for Nifty, Bank Nifty, and other indices.",
    group: "Market Data",
  },
  {
    id: "default-india-vix",
    label: "India VIX",
    url: "https://www.nseindia.com/market-data/india-vix",
    description: "Volatility index, useful for gauging premium levels.",
    group: "Market Data",
  },
  {
    id: "default-bse-india",
    label: "BSE India",
    url: "https://www.bseindia.com/",
    description: "Sensex quotes and market data.",
    group: "Market Data",
  },
  {
    id: "default-nse-india",
    label: "NSE India",
    url: "https://www.nseindia.com/",
    description: "Exchange notices, circulars, and market status.",
    group: "Exchange & Regulatory",
  },
  {
    id: "default-nse-holidays",
    label: "NSE Market Holidays",
    url: "https://www.nseindia.com/resources/exchange-communication-holidays",
    description: "Trading holiday calendar.",
    group: "Exchange & Regulatory",
  },
  {
    id: "default-sebi",
    label: "SEBI",
    url: "https://www.sebi.gov.in/",
    description: "Regulatory circulars and investor guidance.",
    group: "Exchange & Regulatory",
  },
];

/** Group names seeded by DEFAULT_LINKS — used to keep built-in links visually separate from custom ones. */
export const NECESSARY_LINK_GROUPS: string[] = Array.from(new Set(DEFAULT_LINKS.map((link) => link.group)));

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `link_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function readAll(): LinkItem[] {
  if (typeof window === "undefined") return DEFAULT_LINKS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      writeAll(DEFAULT_LINKS);
      return DEFAULT_LINKS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_LINKS;
  } catch {
    return DEFAULT_LINKS;
  }
}

function writeAll(links: LinkItem[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
}

export async function getLinks(): Promise<LinkItem[]> {
  return readAll();
}

export type AddLinkInput = {
  label: string;
  url: string;
  description?: string;
  group: string;
};

export async function addLink(input: AddLinkInput): Promise<LinkItem> {
  const link: LinkItem = { id: uuid(), ...input };
  writeAll([...readAll(), link]);
  logEvent(`Added link: ${link.label}`);
  return link;
}

export async function deleteLink(id: string): Promise<void> {
  const links = readAll();
  const link = links.find((l) => l.id === id);
  writeAll(links.filter((l) => l.id !== id));
  if (link) logEvent(`Deleted link: ${link.label}`);
}
