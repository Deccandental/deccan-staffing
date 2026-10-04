"use client";

import { useState, useEffect } from "react";
import { formatMoney, formatUSD } from "@/lib/format";
import { Debt, DebtKind, DebtCategory, CATEGORY_LABEL, CATEGORY_SHORT, LOAN_CATEGORIES, categoryRank, loadDebts, saveDebt, deleteDebt, computeDebtSummary, loadDebtStatements, saveDebtStatement, deleteDebtStatement, updateDebtStatementAmount } from "@/lib/debt";
import {
  CreditCard, BalanceCheck, CashAccount, CardCharge, RecurringBill, BillPayment,
  buildOccurrences, addDays, addRecurringBill, updateRecurringBill, updateBalanceCheckAmount, updateStatementEntryAmount,
  computeAccountForecast, computeSuggestedTransferMulti, computeCardRecommendation,
  addBalanceCheck, loadBalanceHistoryForAccount, deleteBalanceCheck,
  updateStatementBalance, loadStatementHistoryForCard, backfillStatementMonth, deleteStatementEntry,
} from "@/lib/cashflow";
import { balanceWarnings, statementWarnings, coveredMonth } from "@/lib/staleness";
import { HistoryBlock, HistoryButton, MonthSelect, NumInput, UpdatedStamp, monthLabel, HistRow } from "@/components/CashHistory";

const EMPTY: Omit<Debt, "id"> = {
  name: "", kind: "installment", creditCardId: null, originalAmount: 0, currentBalance: 0,
  interestRate: null, monthlyPayment: 0, finalPaymentDate: null, lender: "", notes: "",
  active: true, sortOrder: 0,
  category: "other", rateType: null, prepayPenalty: false, paidInFullMonthly: false, extraMonthly: 0, extraLabel: "",
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
  // Scheduled payment for the loan being added/edited: none, link an existing bill, or create one.
  type PayLink = { mode: "none" | "existing" | "create"; billId: string; accountId: string; day: string };
  const [payLink, setPayLink] = useState<PayLink>({ mode: "none", billId: "", accountId: "", day: "1" });
  const linkedBillFor = (debtId?: string) => (debtId ? allBills.find((b) => b.linkedDebtId === debtId && b.active) : undefined);
  function openForm(base: Omit<Debt, "id"> & { id?: string }) {
    const b = linkedBillFor(base.id);
    setPayLink(b ? { mode: "existing", billId: b.id, accountId: b.cashAccountId ?? "", day: "1" } : { mode: "none", billId: "", accountId: cashAccounts[0]?.id ?? "", day: "1" });
    setForm({ ...base }); setShowForm(true);
  }
  // ---- Card warnings (moved here from the old Credit Cards tab) ----
  const nowD = new Date();
  const today = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, "0")}-${String(nowD.getDate()).padStart(2, "0")}`;
  const monthStart = today.slice(0, 8) + "01";
  const forecastFor = (acct: CashAccount) =>
    computeAccountForecast(acct, latestBalances[acct.name]?.balance ?? 0,
      buildOccurrences(allBills.filter((b) => b.cashAccountId === acct.id), allPayments, monthStart, addDays(today, 60)), today, 0);
  const transfer = computeSuggestedTransferMulti(cashAccounts.map((a) => forecastFor(a)));

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
      category: "card", rateType: null, prepayPenalty: false, paidInFullMonthly: false, extraMonthly: 0, extraLabel: "",
    };
  }

  const cardDebts: Debt[] = creditCards.map(debtForCard);
  const installmentDebts = debts.filter((d) => d.kind !== "revolving").sort((a, b) => categoryRank(a.category) - categoryRank(b.category));
  // A loan with a linked scheduled payment takes its payment amount from that bill, so
  // the amount is only ever entered once.
  const allDebts = [...cardDebts, ...installmentDebts].map((d) => { const b = d.kind !== "revolving" ? linkedBillFor(d.id) : undefined; return b ? { ...d, monthlyPayment: Math.max(0, b.estimatedAmount - (d.extraMonthly ?? 0)) } : d; });

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
        if (e.pay !== undefined && num(e.pay) != null) {
          payload.monthlyPayment = Number(e.pay);
          const lb = !cc ? linkedBillFor(base.id) : undefined;
          if (lb) await updateRecurringBill(lb.id, { estimatedAmount: Number(e.pay) + (base.extraMonthly ?? 0) });
        }
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
    const debtId = res.id ?? payload.id;

    if (payload.kind !== "revolving") {
      // The balance typed in the form is a real balance: log it, so the chart, the
      // "Updated" date and everything that reads balances see it too.
      const last = latestBalances[payload.name]?.balance;
      if (payload.currentBalance > 0 && (last == null || Math.abs(last - payload.currentBalance) > 0.004)) {
        await addBalanceCheck(payload.name, payload.currentBalance);
      }
      // Scheduled payment: entered once, as a bill, and linked to the loan.
      if (debtId) {
        const prior = linkedBillFor(debtId);
        if (payLink.mode === "none") {
          if (prior) await updateRecurringBill(prior.id, { linkedDebtId: null });
        } else if (payLink.mode === "existing" && payLink.billId) {
          if (prior && prior.id !== payLink.billId) await updateRecurringBill(prior.id, { linkedDebtId: null });
          await updateRecurringBill(payLink.billId, { linkedDebtId: debtId, estimatedAmount: payload.monthlyPayment + (payload.extraMonthly || 0) });
        } else if (payLink.mode === "create" && payLink.accountId) {
          const day = Math.min(28, Math.max(1, Number(payLink.day) || 1));
          const now = new Date();
          let due = new Date(now.getFullYear(), now.getMonth(), day);
          if (due < new Date(now.getFullYear(), now.getMonth(), now.getDate())) due = new Date(now.getFullYear(), now.getMonth() + 1, day);
          const anchorDate = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
          if (prior) await updateRecurringBill(prior.id, { linkedDebtId: null });
          await addRecurringBill({
            name: `${payload.name} payment`, estimatedAmount: payload.monthlyPayment + (payload.extraMonthly || 0), frequency: "monthly", anchorDate,
            category: "bill", active: true, cashAccountId: payLink.accountId, direction: "outflow", essential: true, linkedDebtId: debtId,
          });
        }
      }
    }
    setError(""); setShowForm(false); setForm({ ...EMPTY });
    refresh();
    refreshAll?.();
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
          Debt <span className="font-normal text-xs text-slate-400">· set up and edit rates, payments and where each is paid from here; update balances and statements on the Overview cards</span>
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
            <button onClick={() => openForm({ ...EMPTY })} className="rounded-lg px-3 py-1 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>+ Add Loan</button>
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
          {summary.extraMonthlyTotal > 0 && (
            <span title="Insurance and fees paid alongside loans. They're a real monthly cost and are in Need to collect, but they aren't debt service.">
              <span className="text-xs text-slate-400">Insurance &amp; fees on loans </span><span className="font-bold" style={{ color: "#4A4238" }}>${formatMoney(summary.extraMonthlyTotal)}/mo</span>
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
                    <label className={lbl}>Additional monthly charge (optional)</label>
                    <NumInput onFocus={(e) => e.target.select()} value={form.extraMonthly || ""} placeholder="0.00" onChange={(e) => setForm((f) => ({ ...f, extraMonthly: Number(e.target.value) }))} className={formInput} />
                    <p className="text-xs text-slate-400 mt-1">Insurance or fees paid with the loan. It's paid out of your cash but isn't part of the loan.</p>
                  </div>
                  <div>
                    <label className={lbl}>What is it?</label>
                    <input value={form.extraLabel} onChange={(e) => setForm((f) => ({ ...f, extraLabel: e.target.value }))} placeholder="Insurance" className={formInput} />
                  </div>
                </>
              )}
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
              {form.kind !== "revolving" && (
                <div className="sm:col-span-3 rounded-lg bg-slate-50 px-3 py-2.5">
                  <label className={lbl}>Scheduled payment <span className="font-normal text-slate-400">— so it's entered once, not twice</span></label>
                  <select
                    value={payLink.mode === "existing" ? payLink.billId : payLink.mode === "create" ? "__create" : ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") setPayLink((p) => ({ ...p, mode: "none", billId: "" }));
                      else if (v === "__create") setPayLink((p) => ({ ...p, mode: "create", billId: "", accountId: p.accountId || cashAccounts[0]?.id || "" }));
                      else {
                        const b = allBills.find((x) => x.id === v);
                        setPayLink((p) => ({ ...p, mode: "existing", billId: v, accountId: b?.cashAccountId ?? p.accountId }));
                        if (b) setForm((f) => ({ ...f, monthlyPayment: Math.max(0, b.estimatedAmount - (f.extraMonthly || 0)) }));
                      }
                    }}
                    className={`${formInput} bg-white`}>
                    <option value="">Not scheduled in a bank account</option>
                    <optgroup label="Link a payment that's already scheduled">
                      {allBills.filter((b) => b.active && b.direction === "outflow" && !b.linkedCreditCardId && (!b.linkedDebtId || b.linkedDebtId === form.id)).map((b) => (
                        <option key={b.id} value={b.id}>{b.name} — ${formatMoney(b.estimatedAmount)} — {cashAccounts.find((a) => a.id === b.cashAccountId)?.name ?? "no account"}</option>
                      ))}
                    </optgroup>
                    <option value="__create">Create the scheduled payment for me…</option>
                  </select>
                  {payLink.mode === "existing" && (() => {
                    const b = allBills.find((x) => x.id === payLink.billId);
                    return b ? <p className="text-xs text-slate-500 mt-1">Paid from <strong>{cashAccounts.find((a) => a.id === b.cashAccountId)?.name ?? "no account"}</strong>. This bill and the loan's monthly payment are kept equal, and it's counted once in Need to collect.</p> : null;
                  })()}
                  {payLink.mode === "create" && (
                    <div className="flex flex-wrap items-end gap-3 mt-2">
                      <div>
                        <label className={lbl}>Paid from</label>
                        <select value={payLink.accountId} onChange={(e) => setPayLink((p) => ({ ...p, accountId: e.target.value }))} className={`${formInput} bg-white`} style={{ width: 200 }}>
                          {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={lbl}>Due day of the month</label>
                        <input type="number" min={1} max={28} value={payLink.day} onChange={(e) => setPayLink((p) => ({ ...p, day: e.target.value }))} className={formInput} style={{ width: 90 }} />
                      </div>
                      <p className="text-xs text-slate-400 pb-2">A monthly bill for the payment above is added to that account.</p>
                    </div>
                  )}
                </div>
              )}
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
                <span>Debt</span><span>Current bal.</span><span>Latest statement</span><span>Rate %</span><span>Payment</span><span>Interest/mo</span><span>Clear in</span><span>Last update</span><span />
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
                        {!cc && (d.extraMonthly ?? 0) > 0 && <span className="text-slate-400" title={`${d.extraLabel || "Additional charge"}: $${formatMoney(d.extraMonthly)}/mo, paid with the loan but not part of it`}> · +${formatMoney(d.extraMonthly)} {(d.extraLabel || "extra").toLowerCase()}</span>}
                        {!cc && (() => { const lb = linkedBillFor(d.id); const acct = lb ? cashAccounts.find((a) => a.id === lb.cashAccountId)?.name : null; return lb ? <span className="text-slate-400" title={`Scheduled payment: ${lb.name}`}> · {acct ?? "scheduled"}</span> : null; })()}
                      </span>
                      <span className="text-slate-700 whitespace-nowrap" title="Update balances on the Overview cards">${formatMoney(Number(curVal) || 0)}</span>
                      <span className="text-slate-600 whitespace-nowrap" title="Update statements on the Overview cards">{hist[0] ? `${monthLabel(hist[0].month)} $${formatMoney(hist[0].balance)}` : "—"}</span>
                      <NumInput prefix="" suffix="%" step="0.01" min="0" onFocus={(ev) => ev.target.select()} value={rateVal} placeholder="not set" onChange={(ev) => setEdit(key, { rate: ev.target.value })} className={cell} />
                      <NumInput onFocus={(ev) => ev.target.select()} value={payVal} onChange={(ev) => setEdit(key, { pay: ev.target.value })} className={cell} />
                      <span className="whitespace-nowrap" style={{ color: l.monthlyInterest > 0 ? "#A32D2D" : undefined }}>{l.counted ? `$${formatMoney(l.monthlyInterest)}` : "—"}</span>
                      <span className="whitespace-nowrap" style={{ color: l.neverClears ? "#A32D2D" : "rgba(74,66,56,0.6)" }}>
                        {!l.counted ? "monthly" : l.neverClears ? "⚠️ never" : fmtMonths(l.payoffMonths)}
                        {d.finalPaymentDate && !l.neverClears && <span className="text-slate-400"> · {new Date(d.finalPaymentDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" })}</span>}
                      </span>
                      <UpdatedStamp when={status.when} prefix="" />
                      <span className="text-right whitespace-nowrap">
                        <button onClick={() => openForm({ ...d })} className="text-xs text-orange-500 hover:underline">Edit</button>
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
                                value: formatUSD(b.balance), amount: b.balance,
                                onAmount: (n) => updateBalanceCheckAmount(b.id, n),
                                onDelete: () => deleteBalanceCheck(b.id),
                              })),
                            },
                            {
                              title: "Statement balance — by month covered",
                              load: async () => (cc ? await loadStatementHistoryForCard(cc.id) : await loadDebtStatements(d.id)).map((st): HistRow => ({
                                id: st.id, label: monthLabel(st.month), month: st.month, value: formatUSD(st.balance), amount: st.balance,
                                onAmount: (n) => (cc ? updateStatementEntryAmount(st.id, n) : updateDebtStatementAmount(st.id, n)),
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
