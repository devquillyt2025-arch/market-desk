"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { logEvent } from "@/lib/activityLog";

const PAGE_LABELS: Record<string, string> = {
  "/": "Brokerage Calculator",
  "/history": "History",
  "/links": "Important Links",
  "/logs": "Logs",
};

export default function PageViewLogger() {
  const pathname = usePathname();

  useEffect(() => {
    logEvent(`Opened ${PAGE_LABELS[pathname] ?? pathname}`);
  }, [pathname]);

  return null;
}
