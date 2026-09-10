import { supabase } from "./supabase";

export const MAX_RANK = 5;
// Borda-style weighting: rank 1 is worth the most, rank 5 the least.
export function rankWeight(rank: number): number {
  return MAX_RANK + 1 - rank;
}

export interface WishlistItem {
  id: string;
  description: string;
  estimatedCost: number | null;
  addedByEmployeeId: number | null;
  addedByName: string;
  sortOrder: number;
  createdAt: string;
  score: number; // sum of rankWeight across every voter's pick of this item
  myRank: number | null; // 1-5 if the current person has ranked this item, else null
}

function fromItemRow(row: any, score: number, myRank: number | null): WishlistItem {
  return {
    id: row.id, description: row.description, estimatedCost: row.estimated_cost,
    addedByEmployeeId: row.added_by_employee_id, addedByName: row.added_by_name,
    sortOrder: row.sort_order ?? 0, createdAt: row.created_at,
    score, myRank,
  };
}

export async function loadWishlistItems(myEmployeeId: number | null): Promise<WishlistItem[]> {
  const [itemsRes, votesRes] = await Promise.all([
    supabase.from("wishlist_items").select("*").order("sort_order"),
    supabase.from("wishlist_votes").select("*"),
  ]);
  if (itemsRes.error) { console.error("loadWishlistItems error:", itemsRes.error); return []; }
  if (votesRes.error) console.error("loadWishlistItems (votes) error:", votesRes.error);
  const votes = votesRes.data ?? [];
  const scoreByItem = new Map<string, number>();
  const myRankByItem = new Map<string, number>();
  for (const v of votes) {
    scoreByItem.set(v.item_id, (scoreByItem.get(v.item_id) ?? 0) + rankWeight(v.rank));
    if (myEmployeeId != null && v.employee_id === myEmployeeId) myRankByItem.set(v.item_id, v.rank);
  }
  return (itemsRes.data ?? []).map((row) =>
    fromItemRow(row, scoreByItem.get(row.id) ?? 0, myRankByItem.get(row.id) ?? null)
  );
}

// Returns a map of rank (1-5) -> item id for everything the current person
// has currently ranked, so the UI can show/gray-out taken ranks.
export async function loadMyRanks(myEmployeeId: number): Promise<Record<number, string>> {
  const { data, error } = await supabase.from("wishlist_votes").select("*").eq("employee_id", myEmployeeId);
  if (error) { console.error("loadMyRanks error:", error); return {}; }
  const map: Record<number, string> = {};
  for (const row of data ?? []) map[row.rank] = row.item_id;
  return map;
}

export async function addWishlistItem(description: string, estimatedCost: number | null, employeeId: number | null, employeeName: string): Promise<void> {
  const { data: maxRow } = await supabase.from("wishlist_items").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const nextOrder = (maxRow?.sort_order ?? 0) + 1;
  const { error } = await supabase.from("wishlist_items").insert({
    description, estimated_cost: estimatedCost, added_by_employee_id: employeeId, added_by_name: employeeName, sort_order: nextOrder,
  });
  if (error) console.error("addWishlistItem error:", error);
}

export async function deleteWishlistItem(id: string): Promise<void> {
  const { error } = await supabase.from("wishlist_items").delete().eq("id", id);
  if (error) console.error("deleteWishlistItem error:", error);
}

export async function moveWishlistItem(items: WishlistItem[], itemId: string, direction: "up" | "down"): Promise<void> {
  const ordered = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const idx = ordered.findIndex((i) => i.id === itemId);
  if (idx === -1) return;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= ordered.length) return;
  const a = ordered[idx];
  const b = ordered[swapIdx];
  const { error: e1 } = await supabase.from("wishlist_items").update({ sort_order: b.sortOrder }).eq("id", a.id);
  const { error: e2 } = await supabase.from("wishlist_items").update({ sort_order: a.sortOrder }).eq("id", b.id);
  if (e1) console.error("moveWishlistItem error:", e1);
  if (e2) console.error("moveWishlistItem error:", e2);
}

// Sets `itemId` to `rank` (1-5) for this person, replacing whatever they
// previously had at that rank and clearing any prior rank they'd given
// this same item. Pass rank=null to simply clear their pick for this item.
export async function setMyRank(itemId: string, employeeId: number, rank: number | null): Promise<void> {
  // Clear this item from wherever it currently sits for this person.
  const { error: clearItemErr } = await supabase.from("wishlist_votes").delete().eq("employee_id", employeeId).eq("item_id", itemId);
  if (clearItemErr) console.error("setMyRank (clear item) error:", clearItemErr);
  if (rank == null) return;
  // Clear whatever this person previously had at the target rank.
  const { error: clearRankErr } = await supabase.from("wishlist_votes").delete().eq("employee_id", employeeId).eq("rank", rank);
  if (clearRankErr) console.error("setMyRank (clear rank) error:", clearRankErr);
  const { error: insertErr } = await supabase.from("wishlist_votes").insert({ item_id: itemId, employee_id: employeeId, rank });
  if (insertErr) console.error("setMyRank (insert) error:", insertErr);
}
