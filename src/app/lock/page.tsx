import type { Metadata } from "next";

import { safeNextPath } from "@/lib/pinAuth";

import LockForm from "./LockForm";

export const metadata: Metadata = {
  title: "Locked",
  robots: { index: false, follow: false },
};

export default async function LockPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <LockForm next={safeNextPath(next)} />;
}
