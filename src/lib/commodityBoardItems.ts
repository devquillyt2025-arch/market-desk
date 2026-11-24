/** The commodities board as the Watchlist's polling takes it - shared by the Commodities page and the Dashboard, so both read (and keep on this device) the same prices. */

import { BOARD_SYMBOLS } from "@/lib/commodityBoard";
import { commodityName } from "@/lib/mcxCommodities";
import { commodityItemKey, type WatchlistItem } from "@/lib/watchlist";

/** The board is the Watchlist's commodities, polled the same way: one request, the same token and offline handling, prices kept on this device. */
export const BOARD_ITEMS: WatchlistItem[] = BOARD_SYMBOLS.map((symbol, index) => ({
  id: symbol,
  kind: "commodity",
  itemKey: commodityItemKey(symbol),
  symbol,
  name: commodityName(symbol),
  sortOrder: index,
}));

/** Where the last prices are kept, so a reload (or a morning the token has lapsed) still shows something. */
export const BOARD_STORAGE_KEY = "marketdesk:commodities-quotes";
