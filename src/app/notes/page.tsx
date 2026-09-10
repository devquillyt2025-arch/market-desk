import type { Metadata } from "next";

import NotesShell from "@/components/NotesShell";

export const metadata: Metadata = {
  title: "Notes",
};

export default function NotesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ideas, reminders, and things worth remembering — all in one place.
        </p>
      </div>
      <NotesShell />
    </div>
  );
}
