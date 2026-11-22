/**
 * Icons for the pages in lib/navPages.ts, for the sidebar, the phone's tab bar and More sheet, and the tab editor. Which pages each
 * of those shows, and in what order, is the device's choice (lib/navPrefs.ts).
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
import { SETTINGS_PAGE, type NavPage } from "@/lib/navPages";

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

export const SETTINGS_LINK: NavLink = { ...SETTINGS_PAGE, icon: SettingsIcon };
