"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { CreditCard, CardCharge, addCardCharge, updateCardCharge, deleteCardCharge } from "@/lib/cashflow";
import { NumInput } from "@/components/CashHistory";

/**
 * Recurring charges that post to each credit card (software, supplies, etc.).
 * The near-limit warning on the Weekly Update tab's Debt card is projected
 * from these, so this page is just for adding and editing them.
 */

type Draft = { vendor: string; amount: string; day: string; notes: string };

const box = "rounded border border-slate-200 px-1.5 py-1 text-xs focus:outline-none";
const ROW = "minmax(150px,1.4fr) 100px 60px minmax(120px,1.2fr) 90px";

function draftOf(c: CardCharge): Draft {
  return { vendor: c.vendor, amount: String(c.typicalAmount), day: String(c.approxDayOfMonth), notes: c.notes ?? "" };
}

export default function CardChargesPanel({ cards, charges, refreshAll }: {
  cards: CreditCard[]; charges: CardCharge[]; refreshAll: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [adds, setAdds] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);

  const isDirty = (c: CardCharge) => {
    const d = drafts[c.id];
    if (!d) return false;
    const o = draftOf(c);
    return d.vendor !== o.vendor || d.amount !== o.amount || d.day !== o.day || d.notes !== o.notes;
  };

  async function saveRow(c: CardCharge) {
    const d = drafts[c.id];
    if (!d) return;
    const amount = Number(d.amount), day = Number(d.day);
    if (!d.vendor.trim() || !amount || !day || day < 1 || day > 31) { setError("Each charge needs a vendor, an amount, and a day between 1 and 31."); return; }
    setError(null);
    await updateCardCharge(c.id, { vendor: d.vendor.trim(), typicalAmount: amount, approxDayOfMonth: day, notes: d.notes.trim() });
    setDrafts((s) => { const n = { ...s }; delete n[c.id]; return n; });
    refreshAll();
  }

  async function addRow(cardId: string) {
    const a = adds[cardId];
    if (!a) return;
    const amount = Number(a.amount), day = Number(a.day || "1");
    if (!a.vendor.trim() || !amount || !day || day < 1 || day > 31) { setError("A new charge needs a vendor, an amount, and a day between 1 and 31."); return; }
    setError(null);
    await addCardCharge({ creditCardId: cardId, vendor: a.vendor.trim(), typicalAmount: amount, approxDayOfMonth: day, notes: a.notes.trim() || undefined, active: true });
    setAdds((s) => { const n = { ...s }; delete n[cardId]; return n; });
    refreshAll();
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Recurring charges per card. These feed the near-limit warning on each card's line in the Debt card above.
      </p>
      {error && <p className="text-xs text-red-600 font-semibold">⚠️ {error}</p>}

      {cards.map((card) => {
        const list = charges.filter((c) => c.creditCardId === card.id).sort((a, b) => a.approxDayOfMonth - b.approxDayOfMonth);
        const monthly = list.filter((c) => c.active).reduce((sum, c) => sum + c.typicalAmount, 0);
        const a = adds[card.id] ?? { vendor: "", amount: "", day: "1", notes: "" };
        const setA = (patch: Partial<Draft>) => setAdds((s) => ({ ...s, [card.id]: { ...a, ...patch } }));
        return (
          <div key={card.id} className="rounded-2xl bg-white shadow px-4 py-3">
            <div className="flex items-baseline justify-between gap-2 mb-1.5 flex-wrap">
              <h2 className="font-bold text-sm text-slate-700">{card.name}</h2>
              <span className="text-xs text-slate-500">{list.filter((c) => c.active).length} active · ${formatMoney(monthly)}/mo</span>
            </div>

            <div className="overflow-x-auto">
              <div style={{ minWidth: 640 }}>
                {list.length > 0 && (
                  <div className="grid gap-x-2 text-[11px] text-slate-400 font-medium border-b border-slate-100 pb-1" style={{ gridTemplateColumns: ROW }}>
                    <span>Vendor</span><span>Amount</span><span>Day</span><span>Note</span><span />
                  </div>
                )}
                {list.length === 0 && <p className="text-xs text-slate-400 py-1">No recurring charges logged for this card.</p>}
                {list.map((c) => {
                  const d = drafts[c.id] ?? draftOf(c);
                  const set = (patch: Partial<Draft>) => setDrafts((s) => ({ ...s, [c.id]: { ...d, ...patch } }));
                  const dirty = isDirty(c);
                  return (
                    <div key={c.id} className="grid items-center gap-x-2 py-1 border-b border-slate-50 last:border-0" style={{ gridTemplateColumns: ROW, opacity: c.active ? 1 : 0.5 }}>
                      <input value={d.vendor} onChange={(e) => set({ vendor: e.target.value })} className={`${box} w-full`} />
                      <NumInput onFocus={(e) => e.target.select()} value={d.amount} onChange={(e) => set({ amount: e.target.value })} className={`${box} w-full`} />
                      <input type="number" min={1} max={31} onFocus={(e) => e.target.select()} value={d.day} onChange={(e) => set({ day: e.target.value })} className={`${box} w-full`} />
                      <input value={d.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="—" className={`${box} w-full`} />
                      <span className="text-right whitespace-nowrap text-xs">
                        {dirty && <button onClick={() => saveRow(c)} className="font-semibold text-white rounded px-2 py-0.5 mr-1.5" style={{ backgroundColor: "#dc2626" }}>Save</button>}
                        <button title={c.active ? "Pause — leave it out of the projection" : "Resume"} onClick={async () => { await updateCardCharge(c.id, { active: !c.active }); refreshAll(); }}
                          className="text-slate-400 hover:text-slate-600 mr-1.5">{c.active ? "Pause" : "Resume"}</button>
                        <button title="Delete this charge" onClick={async () => { if (!confirm(`Delete ${c.vendor}?`)) return; await deleteCardCharge(c.id); refreshAll(); }}
                          className="text-red-400 hover:text-red-600">✕</button>
                      </span>
                    </div>
                  );
                })}

                {/* Add row */}
                <div className="grid items-center gap-x-2 pt-2 mt-1 border-t border-slate-100" style={{ gridTemplateColumns: ROW }}>
                  <input value={a.vendor} onChange={(e) => setA({ vendor: e.target.value })} placeholder="New vendor" className={`${box} w-full`} />
                  <NumInput onFocus={(e) => e.target.select()} value={a.amount} onChange={(e) => setA({ amount: e.target.value })} placeholder="Amount" className={`${box} w-full`} />
                  <input type="number" min={1} max={31} onFocus={(e) => e.target.select()} value={a.day} onChange={(e) => setA({ day: e.target.value })} className={`${box} w-full`} />
                  <input value={a.notes} onChange={(e) => setA({ notes: e.target.value })} placeholder="Note (optional)" className={`${box} w-full`} />
                  <span className="text-right"><button onClick={() => addRow(card.id)} className="rounded-lg px-3 py-1 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>+ Add</button></span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
