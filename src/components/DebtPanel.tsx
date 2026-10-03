"use client";

import { useState, useEffect } from "react";
import { formatMoney } from "@/lib/format";
import { Debt, DebtKind, DebtCategory, CATEGORY_LABEL, CATEGORY_SHORT, LOAN_CATEGORIES, categoryRank, loadDebts, saveDebt, deleteDebt, computeDebtSummary, loadDebtStatements, saveDebtStatement, deleteDebtStatement } from "@/lib/debt";
import {
  CreditCard, BalanceCheck, CashAccount, CardCharge, RecurringBill, BillPayment,
  buildOccurrences, addDays,
  computeAccountForecast, computeSuggestedTransfer, computeCardRecommendation,
  addBalanceCheck, loadBalanceHistoryForAccount, deleteBalanceCheck,
  updateStatementBalance, loadStatementHistoryForCard, backfillStatementMonth, deleteStatementEntry,
} from "@/lib/cashflow";
import { balanceWarnings, statementWarnings, coveredMonth } from "@/lib/staleness";
import { HistoryBlock, HistoryButton, MonthSelect, NumInput, UpdatedStamp, monthLabel, HistRow } from "@/components/CashHistory";

const EMPTY: Omit<Debt, "id"> = {
  name: "", kind: "installment", creditCardId: null, originalAmount: 0, currentBalance: 0,
  interestRate: null, monthlyPayment: 0, finalPaymentDate: null, lender: "", notes: "",
  active: true, sortOrder: 0,
  category: "other", rateType: null, prepayPenalty: false, paidInFullMonthly: false,
};

// One line per debt. Cards are edited right on the line (current balance,
// statement balance for a chosen month, rate, payment); loans show their
// figures and use Edit.
const GRID = "minmax(110px,1.2fr) 100px 186px 64px 96px 74px 74px 100px 110px";

type CardEdit = { cur?: string; stmt?: string; rate?: string; pay?: string };

const cell = "w-full rounded border border-slate-200 px-1.5 py-1 text-xs focus:outline-none";

export default function DebtPanel({
  creditCards, latestBalances, refreshAll, monthlyCollections, cashAccounts = [], charges = [], allBills = [], allPayments = [],
}: {
  cashAccounts?: CashAccount[];
  charges?: CardCharge[];
  allBills?: RecurringBill[];
  allPayments?: BillPayment[];
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

  type StmtRow = { id: string; month: string; balance: number; enteredAt: string };
  const [stmtHist, setStmtHist] = useState<Record<string, StmtRow[]>>({});
  const [edits, setEdits] = useState<Record<string, CardEdit>>({});
  const [months, setMonths] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [openHist, setOpenHist] = useState<string | null>(null);
  // ---- Card warnings (moved here from the old Credit Cards tab) ----
  const nowD = new Date();
  const today = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, "0")}-${String(nowD.getDate()).padStart(2, "0")}`;
  const monthStart = today.slice(0, 8) + "01";
  const forecastFor = (acct: CashAccount) =>
    computeAccountForecast(acct, latestBalances[acct.name]?.balance ?? 0,
      buildOccurrences(allBills.filter((b) => b.cashAccountId === acct.id), allPayments, monthStart, addDays(today, 60)), today, 0);
  const ffAcct = cashAccounts.find((a) => a.name === "Fifth Third Checking");
  const chaseAcct = cashAccounts.find((a) => a.name === "Chase");
  const transfer = ffAcct && chaseAcct ? computeSuggestedTransfer(forecastFor(ffAcct), forecastFor(chaseAcct)) : null;

  function recFor(card: CreditCard) {
    const balance = latestBalances[card.name]?.balance ?? 0;
    const linked = cashAccounts.find((a) => a.id === card.linkedCashAccountId);
    let forecast = linked ? forecastFor(linked) : null;
    if (forecast && transfer && linked && transfer.fromAccountName === linked.name) {
      forecast = { ...forecast, excessOrShortfall: Math.max(0, forecast.excessOrShortfall - transfer.amount) };
    }
    return { linked, rec: computeCardRecommendation(card, balance, charges, today, forecast) };
  }


  // Statement logs for every debt: cards read card_statement_entries, loans
  // read debt_statement_entries. Keyed by card id / loan id, newest first.
  async function loadStatements(loans: Debt[] = debts.filter((x) => x.kind !== "revolving")) {
    const [cardEntries, loanEntries] = await Promise.all([
      Promise.all(creditCards.map((c) => loadStatementHistoryForCard(c.id))),
      Promise.all(loans.map((l) => loadDebtStatements(l.id))),
    ]);
    const map: Record<string, StmtRow[]> = {};
    creditCards.forEach((c, i) => { map[c.id] = cardEntries[i]; });
    loans.forEach((l, i) => { map[l.id] = loanEntries[i]; });
    setStmtHist(map);
  }

  async function refresh() {
    setLoading(true);
    const d = await loadDebts();
    await loadStatements(d.filter((x) => x.kind !== "revolving"));
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
      category: "card", rateType: null, prepayPenalty: false, paidInFullMonthly: false,
    };
  }

  const cardDebts: Debt[] = creditCards.map(debtForCard);
  const installmentDebts = debts.filter((d) => d.kind !== "revolving").sort((a, b) => categoryRank(a.category) - categoryRank(b.category));
  const allDebts = [...cardDebts, ...installmentDebts];

  // Interest is charged on the statement balance, so that's the figure the
  // debt totals use; a card with no statement on file falls back to current.
  const cardBalances: Record<string, number> = {};
  for (const cc of creditCards) {
    const latestStmt = stmtHist[cc.id]?.[0]?.balance ?? cc.statementBalance;
    cardBalances[cc.id] = latestStmt > 0 ? latestStmt : (latestBalances[cc.name]?.balance ?? 0);
  }

  const summary = computeDebtSummary(allDebts, cardBalances, monthlyCollections);
  const unratedCards = summary.lines.filter((l) => l.counted && l.debt.kind === "revolving" && l.balance > 0 && l.debt.interestRate == null);

  const setEdit = (id: string, patch: CardEdit) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  const dirty = Object.values(edits).some((e) => Object.keys(e).length > 0);

  async function handleSaveRows() {
    setSaving(true);
    const failures: string[] = [];
    const num = (v?: string) => (v !== undefined && v !== "" && !isNaN(Number(v)) ? Number(v) : null);

    // Cards and loans are saved the same way: current balance, statement
    // balance for the chosen month, rate and payment.
    for (const l of summary.lines) {
      const base = l.debt;
      const cc = base.kind === "revolving" && base.creditCardId ? creditCards.find((c) => c.id === base.creditCardId) : undefined;
      const key = cc ? cc.id : base.id;
      const e = edits[key];
      if (!e) continue;

      const cur = num(e.cur);
      if (cur != null) {
        const r = await addBalanceCheck(base.name, cur);
        if (!r.ok) failures.push(`${base.name} balance (${r.error ?? "failed"})`);
      }

      const stmt = num(e.stmt);
      if (stmt != null) {
        const hist = stmtHist[key] ?? [];
        const month = months[key] ?? hist[0]?.month ?? coveredMonth(cc ? cc.approxClosingDay : null);
        const r = cc ? await updateStatementBalance(cc.id, stmt, month) : await saveDebtStatement(base.id, month, stmt);
        if (!r.ok) failures.push(`${base.name} statement (${r.error ?? "failed"})`);
      }

      // Rate / payment — and, for loans, the current balance — live on the debt row.
      const needsDebtRow = e.rate !== undefined || e.pay !== undefined || (!cc && cur != null);
      if (needsDebtRow) {
        const payload: Omit<Debt, "id"> & { id?: string } = { ...base };
        if (e.rate !== undefined) payload.interestRate = e.rate === "" ? null : (isNaN(Number(e.rate)) ? base.interestRate : Number(e.rate));
        if (e.pay !== undefined && num(e.pay) != null) payload.monthlyPayment = Number(e.pay);
        if (!cc && cur != null) payload.currentBalance = cur;
        if (payload.id?.startsWith("card:")) delete payload.id;
        const r = await saveDebt(payload);
        if (!r.ok) failures.push(`${base.name} rate/payment (${r.error ?? "failed"})`);
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

  // When each line was last touched, and what's overdue on it: current balances
  // weekly for cards (monthly for loans), statement balances monthly.
  function lineStatus(l: (typeof summary.lines)[number]) {
    const d = l.debt;
    const cc = d.kind === "revolving" && d.creditCardId ? creditCards.find((c) => c.id === d.creditCardId) : undefined;
    const key = cc ? cc.id : d.id;
    const hist = stmtHist[key] ?? [];
    const checked = latestBalances[d.name]?.checkedAt ?? null;
    const stmtAt = hist.reduce<string | null>((best, h) => (!best || new Date(h.enteredAt) > new Date(best) ? h.enteredAt : best), null);
    const stamps = [checked, stmtAt].filter((t): t is string => !!t);
    const when = stamps.length ? stamps.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null;

    // Same rules as the tab flag, Overview banner and digest email (lib/staleness).
    const warnings = [
      ...balanceWarnings(checked, cc ? "weekly" : "monthly"),
      ...statementWarnings(hist[0]?.month, coveredMonth(cc ? cc.approxClosingDay : null)),
    ];
    return { when, warnings };
  }
  const overdueCount = loading ? 0 : summary.lines.filter((l) => lineStatus(l).warnings.length > 0).length;

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>;

  const lbl = "block text-xs font-semibold text-slate-500 mb-1";
  const formInput = "w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none";

  return (
    <div className="rounded-2xl bg-white shadow p-3">
      <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
        <h2 className="font-bold text-slate-700 text-sm">
          Debt <span className="font-normal text-xs text-slate-400">· cards appear automatically, with their warnings</span>
          {overdueCount > 0 && <span className="ml-2 text-xs font-semibold" style={{ color: "#b91c1c" }}>⚠️ {overdueCount} {overdueCount === 1 ? "line needs" : "lines need"} updating</span>}
        </h2>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-red-600 font-semibold">⚠️ unsaved</span>}
          {saved && <span className="text-xs text-emerald-600 font-semibold">✓ Saved</span>}
          <button onClick={handleSaveRows} disabled={saving || !dirty}
            className="rounded-lg px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: dirty ? "#dc2626" : "#e8622a" }}>
            {saving ? "Saving…" : "Save Debts"}
          </button>
          {!showForm && (
            <button onClick={() => { setForm({ ...EMPTY }); setShowForm(true); }} className="rounded-lg px-3 py-1 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>+ Add Loan</button>
          )}
        </div>
      </div>
      {saveError && <p className="text-xs text-red-600 font-semibold mb-1">{saveError}</p>}

      {/* Summary leads the card */}
      <div className="rounded-lg bg-slate-50 px-3 py-1.5 mb-1.5 text-sm space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <span><span className="text-xs text-slate-400">Total owed </span><span className="font-bold" style={{ color: "#4A4238" }}>${formatMoney(summary.totalBalance)}</span></span>
          <span>
            <span className="text-xs text-slate-400">Monthly payments </span><span className="font-bold" style={{ color: "#4A4238" }}>${formatMoney(summary.totalMonthlyPayment)}</span>
            {summary.debtServiceRate != null && <span className="text-xs text-slate-400"> ({summary.debtServiceRate.toFixed(1)}% of collections)</span>}
          </span>
          <span style={{ color: summary.totalMonthlyInterest > 0 ? "#A32D2D" : undefined }}>
            <span className="text-xs opacity-70">Interest/mo </span><span className="font-bold">${formatMoney(summary.totalMonthlyInterest)}</span>
            <span className="text-xs opacity-70"> (${formatMoney(summary.totalMonthlyInterest * 12)}/yr)</span>
          </span>
          {summary.fixedServiceMonthly > 0 && (
            <span title="Acquisition, real estate and equipment payments — the fixed obligations a lender measures against collections. Cards and the line of credit are left out because they swing month to month.">
              <span className="text-xs text-slate-400">Fixed loan service </span><span className="font-bold" style={{ color: "#4A4238" }}>${formatMoney(summary.fixedServiceMonthly)}/mo</span>
              {summary.fixedServiceRate != null && <span className="text-xs text-slate-400"> ({summary.fixedServiceRate.toFixed(1)}% of collections)</span>}
            </span>
          )}
        </div>
        {summary.categories.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
            {summary.categories.map((c) => (
              <span key={c.category} title={`${c.count} ${c.count === 1 ? "debt" : "debts"} · interest $${formatMoney(c.interest)}/mo`}>
                <span className="font-semibold text-slate-600">{CATEGORY_SHORT[c.category]}</span> ${formatMoney(c.balance)} · ${formatMoney(c.payment)}/mo
              </span>
            ))}
            {summary.paidMonthlyBalance > 0 && (
              <span title="Cards cleared in full every month — not counted as debt or interest.">
                <span className="font-semibold text-slate-600">Cards paid monthly</span> ${formatMoney(summary.paidMonthlyBalance)} (not counted)
              </span>
            )}
          </div>
        )}
      </div>

      {summary.worstFirst.length > 1 && (
        <div className="rounded-lg px-3 py-1.5 text-xs truncate mb-1.5" style={{ background: "#FAEEDA", color: "#854F0B" }}
          title="Carried cards and the line of credit first, then by rate. Loans with a prepayment penalty are left out because paying early costs more than the rate shows.">
          <span className="font-semibold">Extra dollar goes furthest on: </span>
          {summary.worstFirst.slice(0, 3).map((l, i) => (
            <span key={l.debt.id}>{i > 0 ? " → " : ""}{l.debt.name} {l.debt.interestRate ?? 0}% (${formatMoney(l.monthlyInterest)}/mo)</span>
          ))}
          {summary.skippedForPenalty > 0 && <span className="opacity-70"> · {summary.skippedForPenalty} with a prepayment penalty left out</span>}
        </div>
      )}

      {unratedCards.length > 0 && (
        <div className="rounded-lg px-3 py-1.5 text-xs font-semibold truncate mb-1.5" style={{ background: "#E6F1FB", color: "#185FA5" }}
          title="The rate is on each statement, usually shown as the purchase APR. Enter it in the Rate column.">
          {unratedCards.length === 1 ? "1 card carries a balance but has" : `${unratedCards.length} cards carry a balance but have`} no rate set — interest is understated until it's entered (Rate column).
        </div>
      )}

      <div>
        {showForm && (
          <div className="rounded-xl border border-slate-200 p-4 mb-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className={lbl}>Name</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Practice loan" className={formInput} />
              </div>
              <div>
                <label className={lbl}>Kind</label>
                <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as DebtKind, creditCardId: null, category: e.target.value === "revolving" ? "card" : (f.category === "card" ? "other" : f.category) }))} className={`${formInput} bg-white`}>
                  <option value="installment">Loan / line of credit</option>
                  <option value="revolving">Credit card — balance moves</option>
                </select>
              </div>
              <div>
                <label className={lbl}>Lender (optional)</label>
                <input value={form.lender} onChange={(e) => setForm((f) => ({ ...f, lender: e.target.value }))} className={formInput} />
              </div>

              {form.kind !== "revolving" && (
                <div>
                  <label className={lbl}>Category</label>
                  <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as DebtCategory }))} className={`${formInput} bg-white`}>
                    {LOAN_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                  </select>
                </div>
              )}

              {form.kind === "revolving" ? (
                <div className="sm:col-span-3">
                  <label className={lbl}>Which card</label>
                  <select value={form.creditCardId ?? ""} onChange={(e) => setForm((f) => ({ ...f, creditCardId: e.target.value || null }))} className={`${formInput} bg-white`}>
                    <option value="">Select…</option>
                    {creditCards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">The balance is read from the card's latest statement balance, so it only has to be entered once. Interest is charged on the statement balance, so that's the figure used here.</p>
                  <label className="flex items-center gap-2 mt-2 text-sm text-slate-600">
                    <input type="checkbox" checked={form.paidInFullMonthly} onChange={(e) => setForm((f) => ({ ...f, paidInFullMonthly: e.target.checked }))} />
                    Paid in full every month — don't count it as debt or interest
                  </label>
                </div>
              ) : (
                <>
                  <div>
                    <label className={lbl}>Current balance</label>
                    <NumInput onFocus={(e) => e.target.select()} value={form.currentBalance} onChange={(e) => setForm((f) => ({ ...f, currentBalance: Number(e.target.value) }))} className={formInput} />
                  </div>
                  <div>
                    <label className={lbl}>Original amount (optional)</label>
                    <NumInput onFocus={(e) => e.target.select()} value={form.originalAmount} onChange={(e) => setForm((f) => ({ ...f, originalAmount: Number(e.target.value) }))} className={formInput} />
                  </div>
                  <div>
                    <label className={lbl}>Final payment (optional)</label>
                    <input type="date" value={form.finalPaymentDate ?? ""} onChange={(e) => setForm((f) => ({ ...f, finalPaymentDate: e.target.value || null }))} className={formInput} />
                  </div>
                </>
              )}

              <div>
                <label className={lbl}>Interest rate (annual %)</label>
                <NumInput prefix="" suffix="%" step="0.01" min="0" onFocus={(e) => e.target.select()}
                  value={form.interestRate ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, interestRate: e.target.value === "" ? null : Number(e.target.value) }))}
                  placeholder="24.99 — enter 0 for an introductory 0% rate" className={formInput} />
                <p className="text-xs text-slate-400 mt-1">Leave blank if you don't know it yet. Enter 0 for a genuine 0% promotional rate.</p>
              </div>
              <div>
                <label className={lbl}>Monthly payment</label>
                <NumInput onFocus={(e) => e.target.select()} value={form.monthlyPayment} onChange={(e) => setForm((f) => ({ ...f, monthlyPayment: Number(e.target.value) }))} className={formInput} />
              </div>
              {form.kind !== "revolving" && (
                <>
                  <div>
                    <label className={lbl}>Rate type</label>
                    <select value={form.rateType ?? ""} onChange={(e) => setForm((f) => ({ ...f, rateType: (e.target.value || null) as Debt["rateType"] }))} className={`${formInput} bg-white`}>
                      <option value="">Not set</option>
                      <option value="fixed">Fixed</option>
                      <option value="variable">Variable</option>
                    </select>
                  </div>
                  <div className="flex items-end pb-1.5">
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input type="checkbox" checked={form.prepayPenalty} onChange={(e) => setForm((f) => ({ ...f, prepayPenalty: e.target.checked }))} />
                      Prepayment penalty
                    </label>
                  </div>
                </>
              )}
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
            <div style={{ minWidth: 1010 }}>
              <div className="grid items-end gap-x-2 text-[11px] text-slate-400 font-medium border-b border-slate-100 pb-1" style={{ gridTemplateColumns: GRID }}>
                <span>Debt</span><span>Current bal.</span><span>Statement Balance</span><span>Rate %</span><span>Payment</span><span>Interest/mo</span><span>Clear in</span><span>Last update</span><span />
              </div>

              {summary.lines.map((l) => {
                const d = l.debt;
                const cc = d.kind === "revolving" && d.creditCardId ? creditCards.find((c) => c.id === d.creditCardId) : undefined;
                const key = cc ? cc.id : d.id;
                const e = edits[key] ?? {};
                const hist = stmtHist[key] ?? [];
                const latestMonth = hist[0]?.month;
                const covered = coveredMonth(cc ? cc.approxClosingDay : null);
                const selMonth = months[key] ?? latestMonth ?? covered;
                const entryForSel = hist.find((h) => h.month === selMonth);
                const newerDue = latestMonth != null && covered > latestMonth && selMonth !== covered;
                const curVal = e.cur ?? String(cc ? (latestBalances[cc.name]?.balance ?? 0) : d.currentBalance);
                const stmtVal = e.stmt ?? (entryForSel ? String(entryForSel.balance) : "");
                const rateVal = e.rate ?? (d.interestRate == null ? "" : String(d.interestRate));
                const payVal = e.pay ?? String(d.monthlyPayment);
                const histOpen = openHist === key;
                const cardInfo = cc ? recFor(cc) : null;
                const rec = cardInfo?.rec;
                const status = lineStatus(l);

                return (
                  <div key={key} className="border-b border-slate-50 last:border-0">
                    <div className="grid items-center gap-x-2 text-xs py-1" style={{ gridTemplateColumns: GRID }}>
                      <span className="truncate" title={cc && rec ? `${d.name} — $${formatMoney(rec.availableCredit)} available of $${formatMoney(cc.creditLimit)} · pays from ${cardInfo?.linked?.name ?? "—"} · closes ~day ${cc.approxClosingDay} (${rec.daysUntilClosing}d) · due day ${cc.dueDay} (${rec.daysUntilDue}d)` : `${d.name} — ${CATEGORY_LABEL[d.category]}${d.lender ? ` · ${d.lender}` : ""}${d.rateType ? ` · ${d.rateType} rate` : ""}${d.prepayPenalty ? " · prepayment penalty" : ""}`}>
                        <span className="font-medium text-slate-700">{d.name}</span>
                        <span className="text-slate-400"> · {CATEGORY_SHORT[d.category]}</span>
                        {cc && d.paidInFullMonthly && <span className="text-emerald-600" title="Paid in full every month — not counted as debt or interest"> · paid monthly</span>}
                        {!cc && d.rateType === "variable" && <span className="text-blue-600" title="Variable rate"> · var</span>}
                        {!cc && d.prepayPenalty && <span className="text-red-600" title="Prepayment penalty — paying early costs extra"> · PP</span>}
                      </span>
                      <NumInput onFocus={(ev) => ev.target.select()} value={curVal} onChange={(ev) => setEdit(key, { cur: ev.target.value })} className={cell} />
                      <span className="flex items-center gap-1">
                        <MonthSelect value={selMonth} onChange={(m) => { setMonths((s) => ({ ...s, [key]: m })); setEdits((s) => { const { stmt, ...rest } = s[key] ?? {}; return { ...s, [key]: rest }; }); }} className="w-[74px] shrink-0" />
                        <NumInput onFocus={(ev) => ev.target.select()} value={stmtVal} placeholder="—" onChange={(ev) => setEdit(key, { stmt: ev.target.value })} className={cell} />
                        {newerDue && (
                          <button title={`A ${monthLabel(covered)} statement should be out — click to enter it`}
                            onClick={() => setMonths((s) => ({ ...s, [key]: covered }))}
                            className="text-[10px] font-semibold text-amber-600 whitespace-nowrap hover:underline">{monthLabel(covered).split(" ")[0]}?</button>
                        )}
                      </span>
                      <NumInput prefix="" suffix="%" step="0.01" min="0" onFocus={(ev) => ev.target.select()} value={rateVal} placeholder="not set" onChange={(ev) => setEdit(key, { rate: ev.target.value })} className={cell} />
                      <NumInput onFocus={(ev) => ev.target.select()} value={payVal} onChange={(ev) => setEdit(key, { pay: ev.target.value })} className={cell} />
                      <span className="whitespace-nowrap" style={{ color: l.monthlyInterest > 0 ? "#A32D2D" : undefined }}>{l.counted ? `$${formatMoney(l.monthlyInterest)}` : "—"}</span>
                      <span className="whitespace-nowrap" style={{ color: l.neverClears ? "#A32D2D" : "rgba(74,66,56,0.6)" }}>
                        {!l.counted ? "monthly" : l.neverClears ? "⚠️ never" : fmtMonths(l.payoffMonths)}
                        {d.finalPaymentDate && !l.neverClears && <span className="text-slate-400"> · {new Date(d.finalPaymentDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" })}</span>}
                      </span>
                      <UpdatedStamp when={status.when} warnings={status.warnings} prefix="" />
                      <span className="text-right whitespace-nowrap">
                        <HistoryButton open={histOpen} onClick={() => setOpenHist(histOpen ? null : key)} />
                        <button onClick={() => { setForm({ ...d }); setShowForm(true); }} className="text-xs text-orange-500 hover:underline ml-2">Edit</button>
                        {!cc && (
                          <button onClick={async () => {
                            if (!confirm(`Remove ${d.name} from the register?`)) return;
                            await deleteDebt(d.id); refresh();
                          }} className="text-xs text-red-400 hover:underline ml-2">✕</button>
                        )}
                      </span>
                    </div>
                    {cc && rec && (rec.overLimitRisk || rec.urgentMinimumDue || (rec.suggestedExtraPayment > 0 && !rec.overLimitRisk)) && (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 pb-1.5 text-[11px] font-semibold">
                        {rec.overLimitRisk && (
                          <span className="rounded px-1.5 py-0.5 bg-red-50 text-red-700 border border-red-200">
                            🚨 Near limit in 14d — est. ${formatMoney(rec.projectedBalance)} of ${formatMoney(cc.creditLimit)}; pay down now
                          </span>
                        )}
                        {rec.urgentMinimumDue && (
                          <span className="rounded px-1.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200">
                            ⏰ Due in {rec.daysUntilDue}d — min ${formatMoney(cc.minimumPayment)}, autopay ${formatMoney(cc.autopayAmount)}
                          </span>
                        )}
                        {rec.suggestedExtraPayment > 0 && !rec.overLimitRisk && (
                          <span className="rounded px-1.5 py-0.5 bg-blue-50 text-blue-800 border border-blue-200">
                            💰 {cardInfo?.linked?.name} has spare cash — extra ${formatMoney(rec.suggestedExtraPayment)} toward the ${formatMoney(rec.statementBalance)} statement avoids interest
                          </span>
                        )}
                      </div>
                    )}
                    {histOpen && (
                      <div className="pb-2">
                        <HistoryBlock
                          onChanged={() => { loadStatements(); refreshAll?.(); }}
                          columns={[
                            {
                              title: "Current balance",
                              load: async () => (await loadBalanceHistoryForAccount(d.name, 60)).map((b): HistRow => ({
                                id: b.id,
                                label: new Date(b.checkedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }),
                                value: `$${formatMoney(b.balance)}`,
                                onDelete: () => deleteBalanceCheck(b.id),
                              })),
                            },
                            {
                              title: "Statement balance — by month covered",
                              load: async () => (cc ? await loadStatementHistoryForCard(cc.id) : await loadDebtStatements(d.id)).map((st): HistRow => ({
                                id: st.id, label: monthLabel(st.month), month: st.month, value: `$${formatMoney(st.balance)}`,
                                onMonth: async (m) => {
                                  const all = cc ? await loadStatementHistoryForCard(cc.id) : await loadDebtStatements(d.id);
                                  const clash = all.find((x) => x.month === m && x.id !== st.id);
                                  if (clash && !confirm(`${monthLabel(m)} already has a statement on file ($${formatMoney(clash.balance)}). Replace it with $${formatMoney(st.balance)}?`)) return;
                                  if (cc) { await backfillStatementMonth(cc.id, m, st.balance); await deleteStatementEntry(st.id); }
                                  else { await saveDebtStatement(d.id, m, st.balance); await deleteDebtStatement(st.id); }
                                },
                                onDelete: () => (cc ? deleteStatementEntry(st.id) : deleteDebtStatement(st.id)),
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
          Card totals use the latest statement balance (interest is charged on it), falling back to current when none is on file; loans use their current balance. Cards marked paid-in-full are shown but not counted as debt.
        </p>
      </div>
    </div>
  );
}
