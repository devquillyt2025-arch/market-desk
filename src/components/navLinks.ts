/**
 * The pages from lib/navPages.ts with their icons, for the sidebar (every page) and the phone's tab bar and More sheet.
 */

import {
  ActivityIcon,
  BarChartIcon,
  CalendarIcon,
  CommoditiesIcon,
  EyeIcon,
  FlaskIcon,
  GridIcon,
  LinkIcon,
  LineChartIcon,
  NoteIcon,
  ReceiptIcon,
  SettingsIcon,
  TrendingUpIcon,
  WalletIcon,
} from "@/components/icons";
import { NAV_PAGES, SETTINGS_PAGE, type NavPage } from "@/lib/navPages";

type Icon = React.ComponentType<{ className?: string }>;
export type NavLink = NavPage & { icon: Icon };

const ICONS: Record<string, Icon> = {
  "/commodities": CommoditiesIcon,
  "/portfolio": TrendingUpIcon,
  "/watchlist": EyeIcon,
  "/heatmap": GridIcon,
  "/links": LinkIcon,
  "/": ReceiptIcon,
  "/paper-trade": FlaskIcon,
  "/analysis": LineChartIcon,
  "/entries": CalendarIcon,
  "/reports": BarChartIcon,
  "/payment": WalletIcon,
  "/notes": NoteIcon,
  "/logs": ActivityIcon,
};

export function withIcon(page: NavPage): NavLink {
  return { ...page, icon: ICONS[page.href] ?? GridIcon };
}

export const NAV_LINKS: readonly NavLink[] = NAV_PAGES.map(withIcon);
export const SETTINGS_LINK: NavLink = { ...SETTINGS_PAGE, icon: SettingsIcon };
