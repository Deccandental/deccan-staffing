"use client";

import { useState, useEffect } from "react";
import { formatMoney } from "@/lib/format";
import { Debt, DebtKind, loadDebts, saveDebt, deleteDebt, computeDebtSummary } from "@/lib/debt";
import { CreditCard } from "@/lib/cashflow";

const EMPTY: Omit<Debt, "id"> = {
  name: "", kind: "installment", creditCardId: null, originalAmount: 0, currentBalance: 0,
  interestRate: null, monthlyPayment: 0, finalPaymentDate: null, lender: "", notes: "",
  active: true, sortOrder: 0,
};

export default function DebtPanel({
  creditCards, cardBalances, cardBalanceSource = {}, monthlyCollections,
}: {
  creditCards: CreditCard[];
  cardBalances: Record<string, number>;
  cardBalanceSource?: Record<string, "statement" | "current">;
  monthlyCollections?: number | null;
}) {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Omit<Debt, "id"> & { id?: string }>({ ...EMPTY });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setDebts(await loadDebts());
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  // Every credit card is debt by definition, so they appear here without
  // being added — the cards are already defined on the Credit Cards tab and
  // re-entering them would be duplicate work. A card only needs a row in the
  // debts table once its rate is filled in; until then it's shown from the
  // card record alone, with the payment defaulting to whatever is already
  // scheduled against it.
  const cardDebts: Debt[] = creditCards.map((cc) => {
    const saved = debts.find((d) => d.kind === "revolving" && d.creditCardId === cc.id);
    if (saved) return saved;
    return {
      id: `card:${cc.id}`,
      name: cc.name,
      kind: "revolving" as DebtKind,
      creditCardId: cc.id,
      originalAmount: 0,
      currentBalance: 0,
      interestRate: null,
      monthlyPayment: cc.autopayAmount || cc.minimumPayment || 0,
      finalPaymentDate: null,
      lender: "",
      notes: "",
      active: true,
      sortOrder: cc.sortOrder,
    };
  });
  const installmentDebts = debts.filter((d) => d.kind !== "revolving");
  const allDebts = [...cardDebts, ...installmentDebts];
  const summary = computeDebtSummary(allDebts, cardBalances, monthlyCollections);
  const unratedCards = summary.lines.filter((l) => l.debt.kind === "revolving" && l.balance > 0 && l.debt.interestRate == null);
  const input = "w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none";

  async function handleSave() {
    if (!form.name.trim()) { setError("Give it a name."); return; }
    // A card shown straight from the Credit Cards tab has a placeholder id
    // until it's saved here for the first time.
    const payload = { ...form, name: form.name.trim() };
    if (payload.id?.startsWith("card:")) delete payload.id;
    const res = await saveDebt(payload);
    if (!res.ok) { setError(res.error ?? "Couldn't save."); return; }
    setError(""); setShowForm(false); setForm({ ...EMPTY });
    refresh();
  }

  const fmtMonths = (m: number | null) => {
    if (m === null) return "never at this payment";
    if (m === 0) return "cleared";
    const y = Math.floor(m / 12), mm = m % 12;
    return y > 0 ? `${y}y ${mm}m` : `${mm}m`;
  };

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>;

  return (
    <div className="space-y-4">
      {/* The three figures that matter more than the list itself. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white shadow p-4">
          <p className="text-xs text-slate-400">Total owed</p>
          <p className="text-2xl font-bold" style={{ color: "#4A4238" }}>${formatMoney(summary.totalBalance)}</p>
        </div>
        <div className="rounded-2xl bg-white shadow p-4">
          <p className="text-xs text-slate-400">Monthly payments</p>
          <p className="text-2xl font-bold" style={{ color: "#4A4238" }}>${formatMoney(summary.totalMonthlyPayment)}</p>
          {summary.debtServiceRate != null && (
            <p className="text-xs text-slate-400 mt-0.5">{summary.debtServiceRate.toFixed(1)}% of monthly collections</p>
          )}
        </div>
        <div className="rounded-2xl bg-white shadow p-4" style={{ background: summary.totalMonthlyInterest > 0 ? "#FCEBEB" : undefined }}>
          <p className="text-xs" style={{ color: summary.totalMonthlyInterest > 0 ? "#A32D2D" : "#94a3b8" }}>Interest this month</p>
          <p className="text-2xl font-bold" style={{ color: summary.totalMonthlyInterest > 0 ? "#A32D2D" : "#4A4238" }}>
            ${formatMoney(summary.totalMonthlyInterest)}
          </p>
          <p className="text-xs mt-0.5" style={{ color: summary.totalMonthlyInterest > 0 ? "#A32D2D" : "#94a3b8" }}>
            ${formatMoney(summary.totalMonthlyInterest * 12)} a year just to carry it
          </p>
        </div>
      </div>

      {summary.worstFirst.length > 1 && (
        <div className="rounded-2xl p-4" style={{ background: "#FAEEDA" }}>
          <p className="text-sm font-semibold mb-1" style={{ color: "#854F0B" }}>Where an extra dollar does most good</p>
          <p className="text-xs mb-2" style={{ color: "#854F0B" }}>
            Highest rate first — paying down {summary.worstFirst[0].debt.name} saves more per dollar than any other, whatever the balances are.
          </p>
          <div className="space-y-0.5">
            {summary.worstFirst.slice(0, 4).map((l, i) => (
              <div key={l.debt.id} className="flex items-center justify-between text-xs" style={{ color: "#854F0B" }}>
                <span>{i + 1}. {l.debt.name} — {l.debt.interestRate}%</span>
                <span>${formatMoney(l.monthlyInterest)}/mo interest</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {unratedCards.length > 0 && (
        <div className="rounded-xl px-4 py-3" style={{ background: "#E6F1FB" }}>
          <p className="text-xs font-semibold" style={{ color: "#185FA5" }}>
            {unratedCards.length === 1 ? "One card carries a balance but has" : `${unratedCards.length} cards carry a balance but have`} no interest rate recorded, so the interest figures above are understated. The rate is on each statement, usually shown as the APR for purchases — click Edit on the row to add it.
          </p>
        </div>
      )}

      <div className="rounded-2xl bg-white shadow p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-slate-700">Debts</h2>
          {!showForm && (
            <button onClick={() => { setForm({ ...EMPTY }); setShowForm(true); }} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>+ Add Loan</button>
          )}
        </div>

        {showForm && (
          <div className="rounded-xl border border-slate-200 p-4 mb-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Name</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Practice loan" className={input} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Kind</label>
                <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as DebtKind, creditCardId: null }))} className={`${input} bg-white`}>
                  <option value="installment">Loan — fixed payment, has an end</option>
                  <option value="revolving">Credit card — balance moves</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Lender (optional)</label>
                <input value={form.lender} onChange={(e) => setForm((f) => ({ ...f, lender: e.target.value }))} className={input} />
              </div>

              {form.kind === "revolving" ? (
                <div className="sm:col-span-3">
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Which card</label>
                  <select value={form.creditCardId ?? ""} onChange={(e) => setForm((f) => ({ ...f, creditCardId: e.target.value || null }))} className={`${input} bg-white`}>
                    <option value="">Select…</option>
                    {creditCards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">The balance is read from the card's statement balance on the Credit Cards tab, so it only has to be entered once. Interest is charged on the statement balance, so that's the figure used here.</p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Current balance</label>
                    <input type="number" onFocus={(e) => e.target.select()} value={form.currentBalance} onChange={(e) => setForm((f) => ({ ...f, currentBalance: Number(e.target.value) }))} className={input} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Original amount (optional)</label>
                    <input type="number" onFocus={(e) => e.target.select()} value={form.originalAmount} onChange={(e) => setForm((f) => ({ ...f, originalAmount: Number(e.target.value) }))} className={input} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Final payment (optional)</label>
                    <input type="date" value={form.finalPaymentDate ?? ""} onChange={(e) => setForm((f) => ({ ...f, finalPaymentDate: e.target.value || null }))} className={input} />
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Interest rate (annual %)</label>
                <input type="number" step="0.01" min="0" onFocus={(e) => e.target.select()}
                  value={form.interestRate ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, interestRate: e.target.value === "" ? null : Number(e.target.value) }))}
                  placeholder="24.99 — enter 0 for an introductory 0% rate" className={input} />
                <p className="text-xs text-slate-400 mt-1">Leave blank if you don't know it yet. Enter 0 for a genuine 0% promotional rate — if it expires, note the date in the Note field.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Monthly payment</label>
                <input type="number" onFocus={(e) => e.target.select()} value={form.monthlyPayment} onChange={(e) => setForm((f) => ({ ...f, monthlyPayment: Number(e.target.value) }))} className={input} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Note (optional)</label>
                <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={input} />
              </div>
            </div>
            {error && <p className="text-sm text-red-600 font-semibold mt-2">⚠️ {error}</p>}
            <div className="flex items-center gap-2 mt-3">
              <button onClick={handleSave} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>Save</button>
              <button onClick={() => { setShowForm(false); setError(""); }} className="text-sm text-slate-400 hover:underline">Cancel</button>
            </div>
          </div>
        )}

        {summary.lines.length === 0 ? (
          <p className="text-sm text-slate-400">No cards or loans yet. Credit cards appear here automatically once added on the Credit Cards tab.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-2 py-2 font-medium">Debt</th>
                  <th className="px-2 py-2 font-medium">Balance</th>
                  <th className="px-2 py-2 font-medium">Rate</th>
                  <th className="px-2 py-2 font-medium">Payment</th>
                  <th className="px-2 py-2 font-medium">Interest/mo</th>
                  <th className="px-2 py-2 font-medium">Clear in</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {summary.lines.map((l) => (
                  <tr key={l.debt.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-2 py-2">
                      <span className="font-medium text-slate-700">{l.debt.name}</span>
                      <span className="text-xs text-slate-400"> · {l.debt.kind === "revolving" ? "card" : "loan"}</span>
                      {l.debt.lender && <div className="text-xs text-slate-400">{l.debt.lender}</div>}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      ${formatMoney(l.balance)}
                      {l.debt.kind === "revolving" && l.debt.creditCardId && (
                        <div className="text-xs text-slate-400">
                          {cardBalanceSource[l.debt.creditCardId] === "current" ? "current balance" : "statement balance"}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {l.debt.interestRate == null
                        ? <span className="text-amber-600 text-xs">not set</span>
                        : l.debt.interestRate === 0
                          ? <span style={{ color: "#3B6D11" }}>0%</span>
                          : `${l.debt.interestRate}%`}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">${formatMoney(l.monthlyPayment)}</td>
                    <td className="px-2 py-2 whitespace-nowrap" style={{ color: l.monthlyInterest > 0 ? "#A32D2D" : undefined }}>${formatMoney(l.monthlyInterest)}</td>
                    <td className="px-2 py-2 whitespace-nowrap text-xs" style={{ color: l.neverClears ? "#A32D2D" : "rgba(74,66,56,0.6)" }}>
                      {l.neverClears ? "⚠️ never at this payment" : fmtMonths(l.payoffMonths)}
                      {l.debt.finalPaymentDate && !l.neverClears && (
                        <div className="text-slate-400">ends {new Date(l.debt.finalPaymentDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}</div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      <button onClick={() => { setForm({ ...l.debt }); setShowForm(true); }} className="text-xs text-orange-500 hover:underline mr-2">Edit</button>
                      {!l.debt.id.startsWith("card:") && l.debt.kind !== "revolving" && (
                        <button onClick={async () => {
                          if (!confirm(`Remove ${l.debt.name} from the register?`)) return;
                          await deleteDebt(l.debt.id); refresh();
                        }} className="text-xs text-red-400 hover:underline">Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {summary.lines.some((l) => l.neverClears) && (
          <div className="mt-3 rounded-xl px-3 py-2" style={{ background: "#FCEBEB" }}>
            <p className="text-xs font-semibold" style={{ color: "#A32D2D" }}>
              One or more payments are at or below the monthly interest, so that balance won't come down — it will grow. Worth looking at before anything else here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
