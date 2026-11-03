import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
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
          <ToastHost />
          <div className="flex min-h-screen flex-col lg:flex-row">
            <div className="print:hidden">
              <Sidebar />
            </div>
            <main
              id="main-content"
              tabIndex={-1}
              className="w-full min-w-0 flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-10 print:p-0"
            >
              <div className="mx-auto w-full max-w-6xl print:max-w-none">{children}</div>
            </main>
          </div>
        </MotionProvider>
      </body>
    </html>
  );
}
