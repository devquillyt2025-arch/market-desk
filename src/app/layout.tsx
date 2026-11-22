import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import GlobalMarketsBar from "@/components/GlobalMarketsBar";
import { GlobalMarketsProvider } from "@/components/GlobalMarketsProvider";
import { MobileTabBar, MobileTopBar } from "@/components/MobileChrome";
import MotionProvider from "@/components/MotionProvider";
import Sidebar from "@/components/Sidebar";
import ToastHost from "@/components/ToastHost";
import { getSiteUrl } from "@/lib/siteUrl";

const THEME_INIT_SCRIPT = `
  try {
    var theme = localStorage.getItem("theme");
    if (theme === "light" || theme === "dark") {
      document.documentElement.dataset.theme = theme;
    }
  } catch (e) {}
`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const APP_NAME = "MarketDesk";
const APP_DESCRIPTION =
  "Multi-leg options-selling P&L calculator for Nifty, Bank Nifty, and Sensex.";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  // Added to a phone's home screen it opens as its own app, not a browser tab.
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  // iOS Safari otherwise turns a long number - a P&L like 1,19,820, a price - into a phone-number link.
  formatDetection: { telephone: false },
  openGraph: {
    title: APP_NAME,
    description: APP_DESCRIPTION,
    siteName: APP_NAME,
    type: "website",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description: APP_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Draw under the notch and the home indicator, and let the chrome read their size (env(safe-area-inset-*)) - without this
  // iOS letterboxes the page and the safe-area values are all zero.
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        {/* First tab stop on every page: jumps past the 12 sidebar links straight to the content. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[600] focus:rounded-lg focus:bg-accent-solid focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-foreground print:hidden"
        >
          Skip to main content
        </a>
        <MotionProvider>
          <GlobalMarketsProvider>
            <ToastHost />
            {/*
              Phone (under 1024px): an app screen - a column exactly as tall as the visible screen (dvh follows the browser's
              toolbar), with the top bar, the ticker and the tab bar fixed and only <main> scrolling between them. Nothing
              jumps when the browser's own toolbar slides away, and scrolling stays inside the content. Desktop: the page
              scrolls as a whole beside the sidebar, as it always did. Printing drops all of it.
            */}
            <div className="flex h-dvh flex-col overflow-hidden lg:h-auto lg:min-h-screen lg:flex-row lg:overflow-visible print:h-auto print:overflow-visible">
              <div className="print:hidden">
                <Sidebar />
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <MobileTopBar />
                <GlobalMarketsBar />
                <main
                  id="main-content"
                  tabIndex={-1}
                  className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overscroll-contain pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-4 sm:px-6 sm:pt-6 lg:overflow-visible lg:px-10 lg:py-10 print:overflow-visible print:p-0"
                >
                  <div className="mx-auto w-full max-w-6xl pb-6 lg:pb-0 print:max-w-none print:pb-0">{children}</div>
                </main>
                <MobileTabBar />
              </div>
            </div>
          </GlobalMarketsProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
