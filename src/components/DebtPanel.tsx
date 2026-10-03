"use client";

import { useState, useEffect } from "react";
import { formatMoney } from "@/lib/format";
import { Debt, DebtKind, loadDebts, saveDebt, deleteDebt, computeDebtSummary } from "@/lib/debt";
import {
  CreditCard, BalanceCheck, CardStatementEntry,
  addBalanceCheck, loadBalanceHistoryForAccount, deleteBalanceCheck,
  updateStatementBalance, loadStatementHistoryForCard, backfillStatementMonth, deleteStatementEntry,
} from "@/lib/cashflow";
import { HistoryBlock, HistoryButton, MonthSelect, monthLabel, HistRow } from "@/components/CashHistory";

const EMPTY: Omit<Debt, "id"> = {
  name: "", kind: "installment", creditCardId: null, originalAmount: 0, currentBalance: 0,
  interestRate: null, monthlyPayment: 0, finalPaymentDate: null, lender: "", notes: "",
  active: true, sortOrder: 0,
};

// One line per debt. Cards are edited right on the line (current balance,
// statement balance for a chosen month, rate, payment); loans show their
// figures and use Edit.
const GRID = "minmax(120px,1.3fr) 92px 178px 64px 88px 78px 78px 96px";

// The statement that most recently closed, labelled by the month it closes
// in — e.g. a card that closes on the 12th is, on Oct 2, still showing its
// September statement.
function coveredMonthForCard(closingDay: number): string {
  const d = new Date();
  let y = d.getFullYear();
  let m = d.getMonth(); // 0-based
  if (d.getDate() < (closingDay || 1)) { m -= 1; if (m < 0) { m = 11; y -= 1; } }
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

type CardEdit = { cur?: string; stmt?: string; rate?: string; pay?: string };

const cell = "w-full rounded border border-slate-200 px-1.5 py-1 text-xs focus:outline-none";

export default function DebtPanel({
  creditCards, latestBalances, refreshAll, monthlyCollections,
}: {
  creditCards: CreditCard[];
  latestBalances: Record<string, BalanceCheck>;
  refreshAll?: () => void;
  monthlyCollections?: number | null;
}) {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Omit<Debt, "id"> & { id?: string }>({ ...EMPTY });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  const [stmtHist, setStmtHist] = useState<Record<string, CardStatementEntry[]>>({});
  const [edits, setEdits] = useState<Record<string, CardEdit>>({});
  const [months, setMonths] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [openHist, setOpenHist] = useState<string | null>(null);

  async function loadStatements() {
    const entries = await Promise.all(creditCards.map((c) => loadStatementHistoryForCard(c.id)));
    const map: Record<string, CardStatementEntry[]> = {};
    creditCards.forEach((c, i) => { map[c.id] = entries[i]; }); // already newest month first
    setStmtHist(map);
  }

  async function refresh() {
    setLoading(true);
    const [d] = await Promise.all([loadDebts(), loadStatements()]);
    setDebts(d);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Every credit card is debt by definition, so they appear here without
  // being added. A card only needs a row in the debts table once its rate or
  // payment is filled in; until then it's shown from the card record alone.
  function debtForCard(cc: CreditCard): Debt {
    const saved = debts.find((d) => d.kind === "revolving" && d.creditCardId === cc.id);
    if (saved) return saved;
    return {
      id: `card:${cc.id}`, name: cc.name, kind: "revolving" as DebtKind, creditCardId: cc.id,
      originalAmount: 0, currentBalance: 0, interestRate: null,
      monthlyPayment: cc.autopayAmount || cc.minimumPayment || 0,
      finalPaymentDate: null, lender: "", notes: "", active: true, sortOrder: cc.sortOrder,
    };
  }

  const cardDebts: Debt[] = creditCards.map(debtForCard);
  const installmentDebts = debts.filter((d) => d.kind !== "revolving");
  const allDebts = [...cardDebts, ...installmentDebts];

  // Interest is charged on the statement balance, so that's the figure the
  // debt totals use; a card with no statement on file falls back to current.
  const cardBalances: Record<string, number> = {};
  for (const cc of creditCards) {
    const latestStmt = stmtHist[cc.id]?.[0]?.balance ?? cc.statementBalance;
    cardBalances[cc.id] = latestStmt > 0 ? latestStmt : (latestBalances[cc.name]?.balance ?? 0);
  }

  const summary = computeDebtSummary(allDebts, cardBalances, monthlyCollections);
  const unratedCards = summary.lines.filter((l) => l.debt.kind === "revolving" && l.balance > 0 && l.debt.interestRate == null);

  const setEdit = (id: string, patch: CardEdit) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  const dirty = Object.values(edits).some((e) => Object.keys(e).length > 0);

  async function handleSaveCards() {
    setSaving(true);
    const failures: string[] = [];
    const num = (s?: string) => (s !== undefined && s !== "" && !isNaN(Number(s)) ? Number(s) : null);

    for (const cc of creditCards) {
      const e = edits[cc.id];
      if (!e) continue;

      const cur = num(e.cur);
      if (cur != null) {
        const r = await addBalanceCheck(cc.name, cur);
        if (!r.ok) failures.push(`${cc.name} balance (${r.error ?? "failed"})`);
      }

      const stmt = num(e.stmt);
      if (stmt != null) {
        const hist = stmtHist[cc.id] ?? [];
        const month = months[cc.id] ?? hist[0]?.month ?? coveredMonthForCard(cc.approxClosingDay);
        const r = await updateStatementBalance(cc.id, stmt, month);
        if (!r.ok) failures.push(`${cc.name} statement (${r.error ?? "failed"})`);
      }

      if (e.rate !== undefined || e.pay !== undefined) {
        const base = debtForCard(cc);
        const payload: Omit<Debt, "id"> & { id?: string } = { ...base };
        if (e.rate !== undefined) payload.interestRate = e.rate === "" ? null : (isNaN(Number(e.rate)) ? base.interestRate : Number(e.rate));
        if (e.pay !== undefined && num(e.pay) != null) payload.monthlyPayment = Number(e.pay);
        if (payload.id?.startsWith("card:")) delete payload.id;
        const r = await saveDebt(payload);
        if (!r.ok) failures.push(`${cc.name} rate/payment (${r.error ?? "failed"})`);
      }
    }

    setSaving(false);
    if (failures.length > 0) {
      setSaveError(`⚠️ Some saves failed: ${failures.join("; ")}`);
      setSaved(false);
      return;
    }
    setSaveError(null);
    setEdits({});
    setMonths({});
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    await refresh();
    refreshAll?.();
  }

  async function handleSaveForm() {
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
    if (m === null) return "never";
    if (m === 0) return "cleared";
    const y = Math.floor(m / 12), mm = m % 12;
    return y > 0 ? `${y}y ${mm}m` : `${mm}m`;
  };

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>;

  const lbl = "block text-xs font-semibold text-slate-500 mb-1";
  const formInput = "w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none";

  return (
    <div className="space-y-2">
      {/* The three headline figures, on one line. */}
      <div className="rounded-xl bg-white shadow px-4 py-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
        <span><span className="text-xs text-slate-400">Total owed </span><span className="font-bold" style={{ color: "#4A4238" }}>${formatMoney(summary.totalBalance)}</span></span>
        <span>
          <span className="text-xs text-slate-400">Monthly payments </span><span className="font-bold" style={{ color: "#4A4238" }}>${formatMoney(summary.totalMonthlyPayment)}</span>
          {summary.debtServiceRate != null && <span className="text-xs text-slate-400"> ({summary.debtServiceRate.toFixed(1)}% of collections)</span>}
        </span>
        <span style={{ color: summary.totalMonthlyInterest > 0 ? "#A32D2D" : undefined }}>
          <span className="text-xs opacity-70">Interest/mo </span><span className="font-bold">${formatMoney(summary.totalMonthlyInterest)}</span>
          <span className="text-xs opacity-70"> (${formatMoney(summary.totalMonthlyInterest * 12)}/yr)</span>
        </span>
      </div>

      {summary.worstFirst.length > 1 && (
        <div className="rounded-lg px-3 py-1.5 text-xs truncate" style={{ background: "#FAEEDA", color: "#854F0B" }}
          title="Highest rate first — paying down the top one saves more per dollar than any other, whatever the balances are.">
          <span className="font-semibold">Extra dollar goes furthest on: </span>
          {summary.worstFirst.slice(0, 3).map((l, i) => (
            <span key={l.debt.id}>{i > 0 ? " → " : ""}{l.debt.name} {l.debt.interestRate ?? 0}% (${formatMoney(l.monthlyInterest)}/mo)</span>
          ))}
        </div>
      )}

      {unratedCards.length > 0 && (
        <div className="rounded-lg px-3 py-1.5 text-xs font-semibold truncate" style={{ background: "#E6F1FB", color: "#185FA5" }}
          title="The rate is on each statement, usually shown as the purchase APR. Enter it in the Rate column.">
          {unratedCards.length === 1 ? "1 card carries a balance but has" : `${unratedCards.length} cards carry a balance but have`} no rate set — interest is understated until it's entered (Rate column).
        </div>
      )}

      <div className="rounded-2xl bg-white shadow p-3">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <h2 className="font-bold text-slate-700 text-sm">Debts</h2>
          <div className="flex items-center gap-2">
            {dirty && <span className="text-xs text-red-600 font-semibold">⚠️ unsaved</span>}
            {saved && <span className="text-xs text-emerald-600 font-semibold">✓ Saved</span>}
            <button onClick={handleSaveCards} disabled={saving || !dirty}
              className="rounded-lg px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: dirty ? "#dc2626" : "#e8622a" }}>
              {saving ? "Saving…" : "Save Cards"}
            </button>
            {!showForm && (
              <button onClick={() => { setForm({ ...EMPTY }); setShowForm(true); }} className="rounded-lg px-3 py-1 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>+ Add Loan</button>
            )}
          </div>
        </div>
        {saveError && <p className="text-xs text-red-600 font-semibold mb-2">{saveError}</p>}

        {showForm && (
          <div className="rounded-xl border border-slate-200 p-4 mb-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className={lbl}>Name</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Practice loan" className={formInput} />
              </div>
              <div>
                <label className={lbl}>Kind</label>
                <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as DebtKind, creditCardId: null }))} className={`${formInput} bg-white`}>
                  <option value="installment">Loan — fixed payment, has an end</option>
                  <option value="revolving">Credit card — balance moves</option>
                </select>
              </div>
              <div>
                <label className={lbl}>Lender (optional)</label>
                <input value={form.lender} onChange={(e) => setForm((f) => ({ ...f, lender: e.target.value }))} className={formInput} />
              </div>

              {form.kind === "revolving" ? (
                <div className="sm:col-span-3">
                  <label className={lbl}>Which card</label>
                  <select value={form.creditCardId ?? ""} onChange={(e) => setForm((f) => ({ ...f, creditCardId: e.target.value || null }))} className={`${formInput} bg-white`}>
                    <option value="">Select…</option>
                    {creditCards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">The balance is read from the card's latest statement balance, so it only has to be entered once. Interest is charged on the statement balance, so that's the figure used here.</p>
                </div>
              ) : (
                <>
                  <div>
                    <label className={lbl}>Current balance</label>
                    <input type="number" onFocus={(e) => e.target.select()} value={form.currentBalance} onChange={(e) => setForm((f) => ({ ...f, currentBalance: Number(e.target.value) }))} className={formInput} />
                  </div>
                  <div>
                    <label className={lbl}>Original amount (optional)</label>
                    <input type="number" onFocus={(e) => e.target.select()} value={form.originalAmount} onChange={(e) => setForm((f) => ({ ...f, originalAmount: Number(e.target.value) }))} className={formInput} />
                  </div>
                  <div>
                    <label className={lbl}>Final payment (optional)</label>
                    <input type="date" value={form.finalPaymentDate ?? ""} onChange={(e) => setForm((f) => ({ ...f, finalPaymentDate: e.target.value || null }))} className={formInput} />
                  </div>
                </>
              )}

              <div>
                <label className={lbl}>Interest rate (annual %)</label>
                <input type="number" step="0.01" min="0" onFocus={(e) => e.target.select()}
                  value={form.interestRate ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, interestRate: e.target.value === "" ? null : Number(e.target.value) }))}
                  placeholder="24.99 — enter 0 for an introductory 0% rate" className={formInput} />
                <p className="text-xs text-slate-400 mt-1">Leave blank if you don't know it yet. Enter 0 for a genuine 0% promotional rate.</p>
              </div>
              <div>
                <label className={lbl}>Monthly payment</label>
                <input type="number" onFocus={(e) => e.target.select()} value={form.monthlyPayment} onChange={(e) => setForm((f) => ({ ...f, monthlyPayment: Number(e.target.value) }))} className={formInput} />
              </div>
              <div>
                <label className={lbl}>Note (optional)</label>
                <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={formInput} />
              </div>
            </div>
            {error && <p className="text-sm text-red-600 font-semibold mt-2">⚠️ {error}</p>}
            <div className="flex items-center gap-2 mt-3">
              <button onClick={handleSaveForm} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>Save</button>
              <button onClick={() => { setShowForm(false); setError(""); }} className="text-sm text-slate-400 hover:underline">Cancel</button>
            </div>
          </div>
        )}

        {summary.lines.length === 0 ? (
          <p className="text-sm text-slate-400">No cards or loans yet. Credit cards appear here automatically once added on the Credit Cards tab.</p>
        ) : (
          <div className="overflow-x-auto">
            <div style={{ minWidth: 860 }}>
              <div className="grid items-end gap-x-2 text-[11px] text-slate-400 font-medium border-b border-slate-100 pb-1" style={{ gridTemplateColumns: GRID }}>
                <span>Debt</span><span>Current bal.</span><span>Statement (month covered)</span><span>Rate %</span><span>Payment</span><span>Interest/mo</span><span>Clear in</span><span />
              </div>

              {summary.lines.map((l) => {
                const d = l.debt;
                const cc = d.kind === "revolving" && d.creditCardId ? creditCards.find((c) => c.id === d.creditCardId) : undefined;
                const rowKey = d.id;

                // ----- Loans: read-only line, Edit for changes -----
                if (!cc) {
                  return (
                    <div key={rowKey} className="grid items-center gap-x-2 text-xs border-b border-slate-50 last:border-0 py-1.5" style={{ gridTemplateColumns: GRID }}>
                      <span className="truncate"><span className="font-medium text-slate-700">{d.name}</span><span className="text-slate-400"> · loan{d.lender ? ` · ${d.lender}` : ""}</span></span>
                      <span className="whitespace-nowrap">${formatMoney(l.balance)}</span>
                      <span className="text-slate-300">—</span>
                      <span>{d.interestRate == null ? <span className="text-amber-600">not set</span> : d.interestRate === 0 ? <span style={{ color: "#3B6D11" }}>0%</span> : `${d.interestRate}%`}</span>
                      <span className="whitespace-nowrap">${formatMoney(l.monthlyPayment)}</span>
                      <span className="whitespace-nowrap" style={{ color: l.monthlyInterest > 0 ? "#A32D2D" : undefined }}>${formatMoney(l.monthlyInterest)}</span>
                      <span className="whitespace-nowrap" style={{ color: l.neverClears ? "#A32D2D" : "rgba(74,66,56,0.6)" }}>
                        {l.neverClears ? "⚠️ never" : fmtMonths(l.payoffMonths)}
                        {d.finalPaymentDate && !l.neverClears && <span className="text-slate-400"> · {new Date(d.finalPaymentDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" })}</span>}
                      </span>
                      <span className="text-right whitespace-nowrap">
                        <button onClick={() => { setForm({ ...d }); setShowForm(true); }} className="text-xs text-orange-500 hover:underline mr-2">Edit</button>
                        <button onClick={async () => {
                          if (!confirm(`Remove ${d.name} from the register?`)) return;
                          await deleteDebt(d.id); refresh();
                        }} className="text-xs text-red-400 hover:underline">Delete</button>
                      </span>
                    </div>
                  );
                }

                // ----- Cards: everything on one editable line -----
                const e = edits[cc.id] ?? {};
                const hist = stmtHist[cc.id] ?? [];
                const latestMonth = hist[0]?.month;
                const covered = coveredMonthForCard(cc.approxClosingDay);
                const selMonth = months[cc.id] ?? latestMonth ?? covered;
                const entryForSel = hist.find((h) => h.month === selMonth);
                const newerDue = latestMonth != null && covered > latestMonth && selMonth !== covered;
                const curVal = e.cur ?? String(latestBalances[cc.name]?.balance ?? 0);
                const stmtVal = e.stmt ?? (entryForSel ? String(entryForSel.balance) : "");
                const rateVal = e.rate ?? (d.interestRate == null ? "" : String(d.interestRate));
                const payVal = e.pay ?? String(d.monthlyPayment);
                const histOpen = openHist === cc.id;

                return (
                  <div key={rowKey} className="border-b border-slate-50 last:border-0">
                    <div className="grid items-center gap-x-2 text-xs py-1" style={{ gridTemplateColumns: GRID }}>
                      <span className="truncate" title={d.name}><span className="font-medium text-slate-700">{d.name}</span><span className="text-slate-400"> · card</span></span>
                      <input type="number" onFocus={(ev) => ev.target.select()} value={curVal} onChange={(ev) => setEdit(cc.id, { cur: ev.target.value })} className={cell} />
                      <span className="flex items-center gap-1">
                        <MonthSelect value={selMonth} onChange={(m) => { setMonths((s) => ({ ...s, [cc.id]: m })); setEdits((s) => { const { stmt, ...rest } = s[cc.id] ?? {}; return { ...s, [cc.id]: rest }; }); }} className="w-[74px] shrink-0" />
                        <input type="number" onFocus={(ev) => ev.target.select()} value={stmtVal} placeholder="—" onChange={(ev) => setEdit(cc.id, { stmt: ev.target.value })} className={cell} />
                        {newerDue && (
                          <button title={`A ${monthLabel(covered)} statement should be out — click to enter it`}
                            onClick={() => setMonths((s) => ({ ...s, [cc.id]: covered }))}
                            className="text-[10px] font-semibold text-amber-600 whitespace-nowrap hover:underline">{monthLabel(covered).split(" ")[0]}?</button>
                        )}
                      </span>
                      <input type="number" step="0.01" min="0" onFocus={(ev) => ev.target.select()} value={rateVal} placeholder="not set" onChange={(ev) => setEdit(cc.id, { rate: ev.target.value })} className={cell} />
                      <input type="number" onFocus={(ev) => ev.target.select()} value={payVal} onChange={(ev) => setEdit(cc.id, { pay: ev.target.value })} className={cell} />
                      <span className="whitespace-nowrap" style={{ color: l.monthlyInterest > 0 ? "#A32D2D" : undefined }}>${formatMoney(l.monthlyInterest)}</span>
                      <span className="whitespace-nowrap" style={{ color: l.neverClears ? "#A32D2D" : "rgba(74,66,56,0.6)" }}>{l.neverClears ? "⚠️ never" : fmtMonths(l.payoffMonths)}</span>
                      <span className="text-right whitespace-nowrap">
                        <HistoryButton open={histOpen} onClick={() => setOpenHist(histOpen ? null : cc.id)} />
                        <button onClick={() => { setForm({ ...d }); setShowForm(true); }} className="text-xs text-orange-500 hover:underline ml-2">Edit</button>
                      </span>
                    </div>
                    {histOpen && (
                      <div className="pb-2">
                        <HistoryBlock
                          onChanged={loadStatements}
                          columns={[
                            {
                              title: "Current balance",
                              load: async () => (await loadBalanceHistoryForAccount(cc.name, 60)).map((b): HistRow => ({
                                id: b.id,
                                label: new Date(b.checkedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }),
                                value: `$${formatMoney(b.balance)}`,
                                onDelete: () => deleteBalanceCheck(b.id),
                              })),
                            },
                            {
                              title: "Statement balance — by month covered",
                              load: async () => (await loadStatementHistoryForCard(cc.id)).map((s): HistRow => ({
                                id: s.id, label: monthLabel(s.month), month: s.month, value: `$${formatMoney(s.balance)}`,
                                onMonth: async (m) => {
                                  const clash = (await loadStatementHistoryForCard(cc.id)).find((x) => x.month === m && x.id !== s.id);
                                  if (clash && !confirm(`${monthLabel(m)} already has a statement on file ($${formatMoney(clash.balance)}). Replace it with $${formatMoney(s.balance)}?`)) return;
                                  await backfillStatementMonth(cc.id, m, s.balance);
                                  await deleteStatementEntry(s.id);
                                },
                                onDelete: () => deleteStatementEntry(s.id),
                              })),
                            },
                          ]}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {summary.lines.some((l) => l.neverClears) && (
          <div className="mt-2 rounded-lg px-3 py-1.5" style={{ background: "#FCEBEB" }}>
            <p className="text-xs font-semibold truncate" style={{ color: "#A32D2D" }} title="One or more payments are at or below the monthly interest, so that balance won't come down — it will grow.">
              One or more payments are at or below the monthly interest, so that balance will grow — worth looking at first.
            </p>
          </div>
        )}
        <p className="text-[11px] text-slate-400 mt-2">
          Debt totals use each card's latest statement balance (interest is charged on it), falling back to the current balance when none is on file.
        </p>
      </div>
    </div>
  );
}
