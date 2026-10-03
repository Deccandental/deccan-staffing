"use client";

import { useState, useEffect } from "react";
import { formatMoney } from "@/lib/format";
import { Debt, saveDebtStatement } from "@/lib/debt";
import {
  CashAccount, CreditCard, DentalMonthlyEntry,
  backfillStatementMonth, backfillBankStatementMonth, backfillDentalMonth,
  loadDentalMonthlyHistory, deleteDentalMonthlyEntry,
} from "@/lib/cashflow";
import { MonthSelect, NumInput, monthLabel } from "@/components/CashHistory";

/**
 * Past numbers that the guided update doesn't cover: a statement balance for
 * an earlier month, or the official net production for any month. Replaces the
 * forms the old Trends tab carried. Corrections to existing statement entries
 * are made from each line's History on this page.
 */

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function BackfillPanel({ accounts, cards, loans, refreshAll }: {
  accounts: CashAccount[]; cards: CreditCard[]; loans: Debt[]; refreshAll: () => void;
}) {
  const [entity, setEntity] = useState("");
  const [month, setMonth] = useState(thisMonth());
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [pMonth, setPMonth] = useState(thisMonth());
  const [pAmount, setPAmount] = useState("");
  const [pMsg, setPMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [production, setProduction] = useState<DentalMonthlyEntry[]>([]);

  async function loadProduction() { setProduction(await loadDentalMonthlyHistory()); }
  useEffect(() => { loadProduction(); }, []);

  async function saveStatement() {
    const value = Number(amount);
    if (!entity || !month || amount === "" || isNaN(value)) return;
    const [kind, ...rest] = entity.split(":");
    const id = rest.join(":");
    const r = kind === "bank" ? await backfillBankStatementMonth(id, month, value)
      : kind === "card" ? await backfillStatementMonth(id, month, value)
      : await saveDebtStatement(id, month, value);
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? "Save failed." }); return; }
    const name = [...accounts, ...cards, ...loans].find((x) => x.id === id)?.name ?? "entry";
    setMsg({ ok: true, text: `Saved ${name} — ${monthLabel(month)} — $${formatMoney(value)}` });
    setAmount("");
    refreshAll();
  }

  async function saveProduction() {
    const value = Number(pAmount);
    if (!pMonth || pAmount === "" || isNaN(value)) return;
    const r = await backfillDentalMonth(pMonth, value);
    if (!r.ok) { setPMsg({ ok: false, text: r.error ?? "Save failed." }); return; }
    setPMsg({ ok: true, text: `Saved net production — ${monthLabel(pMonth)} — $${formatMoney(value)}` });
    setPAmount("");
    await loadProduction();
    refreshAll();
  }

  const box = "rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none bg-white";
  const lbl = "block text-xs font-semibold text-slate-500 mb-1";

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-semibold text-sm text-slate-700 mb-1">Past statement balance</h3>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className={lbl}>Account, card or loan</label>
            <select value={entity} onChange={(e) => setEntity(e.target.value)} className={box} style={{ width: 220 }}>
              <option value="">Select…</option>
              <optgroup label="Bank accounts">{accounts.map((a) => <option key={a.id} value={`bank:${a.id}`}>{a.name}</option>)}</optgroup>
              <optgroup label="Credit cards">{cards.map((c) => <option key={c.id} value={`card:${c.id}`}>{c.name}</option>)}</optgroup>
              {loans.length > 0 && <optgroup label="Loans">{loans.map((l) => <option key={l.id} value={`loan:${l.id}`}>{l.name}</option>)}</optgroup>}
            </select>
          </div>
          <div><label className={lbl}>Month covered</label><MonthSelect value={month} onChange={setMonth} className="!py-1.5 !px-2 !text-sm" /></div>
          <div><label className={lbl}>Statement balance</label><NumInput onFocus={(e) => e.target.select()} value={amount} onChange={(e) => setAmount(e.target.value)} wrap="w-36" className={`${box} w-full`} /></div>
          <button onClick={saveStatement} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>Save</button>
        </div>
        {msg && <p className={`text-xs font-semibold mt-1.5 ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.ok ? "✓" : "⚠️"} {msg.text}</p>}
      </div>

      <div className="border-t border-slate-100 pt-3">
        <h3 className="font-semibold text-sm text-slate-700 mb-1">Net production by month</h3>
        <p className="text-xs text-slate-500 mb-2">The official net production figure for any month, past or present. It feeds the production chart and the goal tracking.</p>
        <div className="flex flex-wrap items-end gap-2">
          <div><label className={lbl}>Month</label><MonthSelect value={pMonth} onChange={setPMonth} className="!py-1.5 !px-2 !text-sm" /></div>
          <div><label className={lbl}>Net production</label><NumInput onFocus={(e) => e.target.select()} value={pAmount} onChange={(e) => setPAmount(e.target.value)} wrap="w-36" className={`${box} w-full`} /></div>
          <button onClick={saveProduction} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>Save</button>
        </div>
        {pMsg && <p className={`text-xs font-semibold mt-1.5 ${pMsg.ok ? "text-emerald-600" : "text-red-600"}`}>{pMsg.ok ? "✓" : "⚠️"} {pMsg.text}</p>}

        {production.length > 0 && (
          <div className="mt-2 max-h-44 overflow-y-auto" style={{ maxWidth: 360 }}>
            {production.filter((e) => e.netProduction != null).map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-xs leading-5 border-b border-slate-100 last:border-0">
                <span className="text-slate-500 w-16">{monthLabel(e.month)}</span>
                <span className="font-semibold text-slate-700 flex-1">${formatMoney(e.netProduction as number)}</span>
                <button title="Delete this entry" onClick={async () => { if (!confirm("Delete this production entry? This can't be undone.")) return; await deleteDentalMonthlyEntry(e.id); await loadProduction(); refreshAll(); }} className="text-red-400 hover:text-red-600">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
