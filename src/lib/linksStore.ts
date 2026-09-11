/**
 * Supabase-backed persistence for the Important Links page. The built-in
 * reference links are seeded once in the migration (not here), so every
 * device reads the same starting list instead of each browser seeding its
 * own local copy.
 */

import { logEvent } from "@/lib/activityLog";
import { createClient } from "@/lib/supabase/client";
import { subscribeToTableChanges } from "@/lib/supabase/realtime";
import type { LinkRow } from "@/lib/types";

const supabase = createClient();

export type LinkItem = {
  id: string;
  label: string;
  url: string;
  description?: string;
  group: string;
};

/** Group names seeded by the links migration — used to keep built-in links visually separate from custom ones. */
export const NECESSARY_LINK_GROUPS = ["Market Data", "Exchange & Regulatory"];

function fromRow(row: LinkRow): LinkItem {
  return {
    id: row.id,
    label: row.label,
    url: row.url,
    description: row.description ?? undefined,
    group: row.group_name,
  };
}

/** Last-known result, kept warm so revisiting the tab paints instantly instead of flashing a skeleton. */
let cachedLinks: LinkItem[] | null = null;

/** Synchronous — for a view's initial state, so it can skip the skeleton on a repeat visit. */
export function getCachedLinks(): LinkItem[] | null {
  return cachedLinks;
}

export async function getLinks(): Promise<LinkItem[]> {
  const { data, error } = await supabase.from("links").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  cachedLinks = (data ?? []).map(fromRow);
  return cachedLinks;
}

export type AddLinkInput = {
  label: string;
  url: string;
  description?: string;
  group: string;
};

export async function addLink(input: AddLinkInput): Promise<LinkItem> {
  const { data, error } = await supabase
    .from("links")
    .insert({
      label: input.label,
      url: input.url,
      description: input.description ?? null,
      group_name: input.group,
    })
    .select()
    .single();
  if (error) throw error;

  logEvent(`Added link: ${input.label}`);
  return fromRow(data);
}

export async function deleteLink(id: string): Promise<void> {
  const { data: link, error } = await supabase.from("links").delete().eq("id", id).select().maybeSingle();
  if (error) throw error;
  if (link) logEvent(`Deleted link: ${link.label}`);
}

/** Keeps every open session in sync via Supabase Realtime, same as notesStore.ts. */
export function subscribeToLinkChanges(callback: () => void): () => void {
  return subscribeToTableChanges("links", callback);
}
