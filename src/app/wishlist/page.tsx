"use client";

import { useState, useEffect, useRef } from "react";
import { Sidebar } from "@/components/Sidebar";
import AppIdentityGate, { AppIdentity } from "@/components/AppIdentityGate";
import { formatMoney } from "@/lib/format";
import {
  WishlistItem, MAX_RANK, loadWishlistItems, addWishlistItem, deleteWishlistItem, setWishlistOrder, setMyRank,
} from "@/lib/wishlist";

function WishlistPageBody({ identity }: { identity: AppIdentity }) {
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [description, setDescription] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");

  const myEmployeeId = identity.employeeId ?? null;
  const myName = identity.employeeName ?? "Someone";
  const isAdmin = !!identity.canAdmin;

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    const data = await loadWishlistItems(myEmployeeId);
    setItems(data);
    setLoading(false);
  }

  async function handleAdd() {
    if (!description.trim()) return;
    const cost = estimatedCost.trim() ? Number(estimatedCost) : null;
    await addWishlistItem(description.trim(), cost && !isNaN(cost) ? cost : null, myEmployeeId, myName);
    setDescription("");
    setEstimatedCost("");
    setShowAdd(false);
    await refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this item from the wishlist?")) return;
    await deleteWishlistItem(id);
    await refresh();
  }

  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  function computeTargetIndex(y: number, order: string[]): number {
    for (let i = 0; i < order.length; i++) {
      const el = itemRefs.current.get(order[i]);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) return i;
    }
    return order.length - 1;
  }

  function handleDragStart(e: React.PointerEvent, itemId: string, currentOrder: WishlistItem[]) {
    if (!isAdmin) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDraggingId(itemId);
    setDragOrder(currentOrder.map((i) => i.id));
  }

  function handleDragMove(e: React.PointerEvent) {
    if (!draggingId || !dragOrder) return;
    const targetIdx = computeTargetIndex(e.clientY, dragOrder);
    const currentIdx = dragOrder.indexOf(draggingId);
    if (targetIdx !== currentIdx) {
      const next = dragOrder.filter((id) => id !== draggingId);
      next.splice(targetIdx, 0, draggingId);
      setDragOrder(next);
    }
  }

  async function handleDragEnd() {
    if (!draggingId || !dragOrder) { setDraggingId(null); setDragOrder(null); return; }
    setDraggingId(null);
    await setWishlistOrder(dragOrder);
    setDragOrder(null);
    await refresh();
  }

  async function handlePickRank(item: WishlistItem, rank: number) {
    if (myEmployeeId == null) return;
    const newRank = item.myRank === rank ? null : rank;
    await setMyRank(item.id, myEmployeeId, newRank);
    await refresh();
  }

  const priorityOrder = dragOrder
    ? (dragOrder.map((id) => items.find((i) => i.id === id)).filter(Boolean) as WishlistItem[])
    : [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const mostWanted = [...items].sort((a, b) => b.score - a.score || a.sortOrder - b.sortOrder);
  const usedRanks = new Set(items.filter((i) => i.myRank != null).map((i) => i.myRank as number));
  const ranksLeft = MAX_RANK - usedRanks.size;

  function RankPicker({ item }: { item: WishlistItem }) {
    return (
      <div className="flex items-center gap-1 flex-shrink-0">
        {Array.from({ length: MAX_RANK }, (_, i) => i + 1).map((rank) => {
          const isMine = item.myRank === rank;
          const takenByOther = !isMine && usedRanks.has(rank);
          return (
            <button key={rank} onClick={() => handlePickRank(item, rank)}
              title={isMine ? `Your #${rank} pick — click to remove` : takenByOther ? `Move your #${rank} pick here` : `Set as your #${rank} pick`}
              className="w-6 h-6 rounded-full text-xs font-semibold transition flex-shrink-0"
              style={isMine ? { backgroundColor: "#e8622a", color: "white" } : takenByOther ? { backgroundColor: "#fde68a", color: "#92400e" } : { backgroundColor: "#f1f5f9", color: "#9ca3af" }}>
              {rank}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-16 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <header className="mb-2">
          <h1 className="text-2xl font-bold">Wishlist</h1>
        </header>
        <p className="text-sm text-slate-500 mb-1 max-w-3xl">
          A place for the whole team to suggest things the practice could use — equipment, supplies, software, anything.
          Anyone can add an item. Everyone also gets <strong>5 ranked picks</strong> — your #1 pick counts for more than your #5 —
          and you can move them to different items anytime.
        </p>
        <p className="text-sm text-slate-500 mb-4 max-w-3xl">
          The <strong>Priority List</strong> is the order things will actually be considered in, arranged by an admin.
          The <strong>Most Wanted</strong> list is ranked purely by everyone's picks, so leadership can see what the team wants most.
        </p>

        {loading ? <p className="text-slate-400 text-sm">Loading…</p> : (
          <div className="max-w-5xl space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={() => setShowAdd((s) => !s)} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>
                {showAdd ? "Cancel" : "+ Add to Wishlist"}
              </button>
              {myEmployeeId != null && (
                <span className="text-xs text-slate-400">You have {ranksLeft} of {MAX_RANK} picks left to use.</span>
              )}
            </div>

            {showAdd && (
              <div className="rounded-xl bg-white shadow p-4 grid gap-3 sm:grid-cols-2 max-w-2xl">
                <div className="sm:col-span-2">
                  <label className="block text-xs text-slate-400 mb-0.5">What would you like to add?</label>
                  <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. New intraoral scanner"
                    className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-0.5">Estimated Cost (optional)</label>
                  <input type="number" onFocus={(e) => e.target.select()} value={estimatedCost} onChange={(e) => setEstimatedCost(e.target.value)} placeholder="$"
                    className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                </div>
                <button onClick={handleAdd} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 transition self-end" style={{ backgroundColor: "#e8622a" }}>
                  Add
                </button>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl bg-white shadow p-4">
                <h2 className="font-bold text-slate-700 mb-1">Priority List</h2>
                <p className="text-xs text-slate-400 mb-3">{isAdmin ? "Press and drag a card to reorder." : "Ordered by leadership — only admins can reorder."}</p>
                {priorityOrder.length === 0 ? (
                  <p className="text-sm text-slate-400">Nothing on the wishlist yet.</p>
                ) : (
                  <div className="space-y-2">
                    {priorityOrder.map((item) => (
                      <div key={item.id} ref={(el) => { if (el) itemRefs.current.set(item.id, el); }}
                        className="rounded-xl p-3 flex items-start gap-3 transition"
                        style={{ background: draggingId === item.id ? "#ffedd5" : "#f8fafc", opacity: draggingId === item.id ? 0.85 : 1 }}>
                        {isAdmin && (
                          <div onPointerDown={(e) => handleDragStart(e, item.id, priorityOrder)} onPointerMove={handleDragMove} onPointerUp={handleDragEnd} onPointerCancel={handleDragEnd}
                            className="text-slate-400 flex-shrink-0 select-none" style={{ cursor: "grab", touchAction: "none", fontSize: 18, lineHeight: 1, padding: "2px 4px" }}>
                            ⠿
                          </div>
                        )}
                        <div className="flex-1">
                          <p className="text-sm font-medium text-slate-700">{item.description}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {item.estimatedCost != null && <span className="text-xs text-slate-500">~${formatMoney(item.estimatedCost)}</span>}
                            <span className="text-xs text-gray-400">added by {item.addedByName}</span>
                          </div>
                        </div>
                        {isAdmin && (
                          <button onClick={() => handleDelete(item.id)} className="text-xs text-red-400 hover:underline flex-shrink-0">Remove</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl bg-white shadow p-4">
                <h2 className="font-bold text-slate-700 mb-1">🔥 Most Wanted</h2>
                <p className="text-xs text-slate-400 mb-3">Ranked by everyone's picks — #1 counts for more than #5.</p>
                {mostWanted.length === 0 ? (
                  <p className="text-sm text-slate-400">Nothing on the wishlist yet.</p>
                ) : (
                  <div className="space-y-2">
                    {mostWanted.map((item) => (
                      <div key={item.id} className="rounded-xl bg-slate-50 p-3 flex items-center gap-3">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-slate-700">{item.description}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {item.estimatedCost != null && <span className="text-xs text-slate-500">~${formatMoney(item.estimatedCost)}</span>}
                            <span className="text-xs text-gray-400">added by {item.addedByName}</span>
                            <span className="text-xs text-slate-400">· score {item.score}</span>
                          </div>
                        </div>
                        {myEmployeeId != null && <RankPicker item={item} />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function WishlistPage() {
  return (
    <AppIdentityGate>
      {(identity) => <WishlistPageBody identity={identity} />}
    </AppIdentityGate>
  );
}
