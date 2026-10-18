"use client";

import { useState, useEffect, Fragment } from "react";
import { Sidebar } from "@/components/Sidebar";
import { formatMoney, formatUSD } from "@/lib/format";
import WeeklyUpdatePanel from "@/components/WeeklyUpdatePanel";
import UpdateNumbersFlow from "@/components/UpdateNumbersFlow";
import AccountsPanel from "@/components/AccountsPanel";
import DebtPanel from "@/components/DebtPanel";
import StatementsMonth from "@/components/StatementsMonth";
import StatementsApp from "@/components/StatementsApp";
import { buildStaleItems, StaleItem, newestMonth, monthLabel as stmtMonthLabel, coveredMonth, previousMonth } from "@/lib/staleness";
import BarChart, { BarPoint, BarSeries } from "@/components/BarChart";
import { UpdatedStamp, MonthSelect, NumInput, HistoryBlock, HistColumn, HistRow } from "@/components/CashHistory";
import { updateBalanceCheckAmount, updateStatementEntryAmount, updateBankStatementEntryAmount } from "@/lib/cashflow";
import { loadDebts, loadDebtStatements, Debt, CATEGORY_SHORT, CATEGORY_LABEL, categoryRank, saveDebt, saveDebtStatement, deleteDebtStatement, updateDebtStatementAmount } from "@/lib/debt";
import { loadStaff } from "@/lib/staffStore";
import { getSessionToken } from "@/lib/secureData";
import { loadCompOwed, CompOwedResult } from "@/lib/compOwed";
import { loadHoBonusPayoutYear, loadHoBonusPayments } from "@/lib/hoBonus";
import {
  RecurringBill, BillPayment, BalanceCheck, Occurrence, BillFrequency, BillCategory,
  CashAccount, CreditCard, CardCharge, WeeklyCashReview,
  loadRecurringBills, addRecurringBill, updateRecurringBill,
  loadBillPayments, saveBillPayment, deleteBillPayment,
  loadLatestBalances, addBalanceCheck, loadBalanceHistoryForAccount, deleteBalanceCheck,
  loadStatementHistoryForCard, backfillStatementMonth, deleteStatementEntry, CardStatementEntry,
  updateBankStatementBalance, loadStatementHistoryForAccount, backfillBankStatementMonth, deleteBankStatementEntry, BankStatementEntry,
  loadCashAccounts, updateCashAccountCushion,
  loadCreditCards, updateStatementBalance,
  loadCardCharges, addCardCharge, updateCardCharge, deleteCardCharge,
  loadLatestWeeklyReview, loadWeeklyReviewHistory, saveWeeklyReview, deleteWeeklyReview,
  ArAgingEntry, loadLatestArAging, loadArAgingHistory, saveArAgingEntry, deleteArAgingEntry, computeArHealth, computeAvgMonthlyProduction, withCurrentMonthProjection, computeBonusObligations, BonusObligationsResult,
  loadProductionGoal, saveProductionGoal, computeGoalProgress, GoalProgress,
  loadDentalMonthlyHistory, backfillDentalMonth, deleteDentalMonthlyEntry, DentalMonthlyEntry,
  loadDentalMonthlySummaries, saveDentalMonthlySummary, deleteDentalMonthlySummary, DentalMonthlySummary,
  buildOccurrences, buildStatementOccurrences, StatementOutflows, computeSafeToSpend, addDays, checkBillPayment, projectBalance,
  computeAccountForecast, computeSuggestedTransfer, computeCardRecommendation, computeRequiredCollectionsMulti, computeSuggestedTransferMulti,
} from "@/lib/cashflow";

const FREQ_LABELS: Record<BillFrequency, string> = { weekly: "Weekly", biweekly: "Biweekly", monthly: "Monthly", once: "One-time" };
const WINDOW_DAYS = 60;

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Whole-calendar-day difference between a YYYY-MM-DD string and today,
// computed from date components on both sides (not raw epoch millis) so
// this is immune to timezone offset artifacts from mixing a date-only
// string with a precise instant.
function daysSinceDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - target) / 86400000);
}

function safeColor(amount: number): string {
  if (amount < 0) return "#dc2626";
  if (amount < 3000) return "#f59e0b";
  return "#059669";
}

// ---------------- Account Panel ----------------

// ---------------- Balance History (view + delete a bad entry) ----------------

function ScheduledBillsPanel({ cashAccounts, allBills, allPayments, stmtOcc, latestBalances, cards, refreshAll }: {
  cashAccounts: CashAccount[]; allBills: RecurringBill[]; allPayments: BillPayment[]; stmtOcc: Occurrence[];
  latestBalances: Record<string, BalanceCheck>; cards: CreditCard[]; refreshAll: () => void;
}) {
  const [accountFilter, setAccountFilter] = useState("");
  const [timelineDays, setTimelineDays] = useState(14);
  const [showAddBill, setShowAddBill] = useState(false);
  const emptyForm = { accountId: "", name: "", estimatedAmount: "", frequency: "monthly" as BillFrequency, anchorDate: todayStr(), category: "bill" as BillCategory, categoryLabel: "", direction: "outflow" as "outflow" | "inflow", essential: true };
  const [billForm, setBillForm] = useState(emptyForm);
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [editBillForm, setEditBillForm] = useState(emptyForm);
  const [markPayingFor, setMarkPayingFor] = useState<{ billId: string; dueDate: string } | null>(null);
  const [markAmount, setMarkAmount] = useState("");

  const today = todayStr();
  const monthStart = today.slice(0, 8) + "01";
  const acctName = (id: string | null | undefined) => cashAccounts.find((a) => a.id === id)?.name ?? "";
  const ids = new Set(cashAccounts.map((a) => a.id));
  const bills = allBills.filter((b) => b.cashAccountId && ids.has(b.cashAccountId) && (!accountFilter || b.cashAccountId === accountFilter));
  // Unpaid statements due from an account count as upcoming outflows alongside the scheduled bills.
  const occurrences = [...buildOccurrences(bills, allPayments, monthStart, addDays(today, WINDOW_DAYS)), ...stmtOcc.filter((o) => ids.has(String(o.cashAccountId)) && (!accountFilter || String(o.cashAccountId) === accountFilter))]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  // Safe to spend, one pair per account (what is left after everything scheduled in the next 14 and 30 days).
  const spend = cashAccounts.map((a) => {
    const occ = [...buildOccurrences(allBills.filter((b) => b.cashAccountId === a.id), allPayments, monthStart, addDays(today, WINDOW_DAYS)), ...stmtOcc.filter((o) => String(o.cashAccountId) === String(a.id))];
    const bal = latestBalances[a.name]?.balance ?? 0;
    return { a, s14: computeSafeToSpend(bal, today, occ, 14), s30: computeSafeToSpend(bal, today, occ, 30) };
  });
  const visibleOccurrences = occurrences.filter((occ) => occ.dueDate <= addDays(today, timelineDays));
  const timelineLabel = timelineDays <= 14 ? "Next 2 Weeks" : timelineDays <= 28 ? "Next 4 Weeks" : `Next ${timelineDays} Days`;
  async function handleAddBill() {
    const amount = Number(billForm.estimatedAmount);
    if (!billForm.name.trim() || !amount || !billForm.anchorDate) return;
    await addRecurringBill({
      name: billForm.name.trim(), estimatedAmount: amount, frequency: billForm.frequency,
      anchorDate: billForm.anchorDate, category: billForm.category, categoryLabel: billForm.categoryLabel.trim() || undefined,
      active: true, cashAccountId: billForm.accountId || accountFilter || cashAccounts[0]?.id, direction: billForm.direction, essential: billForm.essential,
    });
    setBillForm(emptyForm);
    setShowAddBill(false);
    refreshAll();
  }

  async function handleDeactivateBill(id: string) {
    if (!confirm("Remove this transaction? It will stop appearing in the upcoming timeline.")) return;
    await updateRecurringBill(id, { active: false });
    refreshAll();
  }

  function startEditBill(b: RecurringBill) {
    setEditingBillId(b.id);
    setEditBillForm({ accountId: b.cashAccountId ?? "", name: b.name, estimatedAmount: String(b.estimatedAmount), frequency: b.frequency, anchorDate: b.anchorDate, category: b.category, categoryLabel: b.categoryLabel ?? "", direction: b.direction, essential: b.essential });
  }

  async function handleSaveEditBill() {
    if (!editingBillId) return;
    const amount = Number(editBillForm.estimatedAmount);
    if (!editBillForm.name.trim() || !amount || !editBillForm.anchorDate) return;
    await updateRecurringBill(editingBillId, {
      name: editBillForm.name.trim(), estimatedAmount: amount, frequency: editBillForm.frequency,
      anchorDate: editBillForm.anchorDate, category: editBillForm.category, categoryLabel: editBillForm.categoryLabel.trim() || undefined,
      direction: editBillForm.direction, essential: editBillForm.essential, ...(editBillForm.accountId ? { cashAccountId: editBillForm.accountId } : {}),
    });
    setEditingBillId(null);
    refreshAll();
  }

  function startMarkPaid(occ: Occurrence) {
    setMarkPayingFor({ billId: occ.billId, dueDate: occ.dueDate });
    // If this occurrence is a linked card payment, default to that card's statement balance.
    const bill = allBills.find((b) => b.id === occ.billId);
    const linkedCard = bill?.linkedCreditCardId ? cards.find((c) => c.id === bill.linkedCreditCardId) : null;
    setMarkAmount(linkedCard ? String(linkedCard.statementBalance) : String(occ.amount));
  }

  async function handleConfirmMarkPaid() {
    if (!markPayingFor) return;
    const amount = Number(markAmount);
    if (!markAmount || isNaN(amount)) return;
    await saveBillPayment(markPayingFor.billId, markPayingFor.dueDate, amount);
    setMarkPayingFor(null);
    refreshAll();
  }

  async function handleUnmarkPaid(occ: Occurrence) {
    await deleteBillPayment(occ.billId, occ.dueDate);
    refreshAll();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">Every scheduled bill, payroll and other recurring payment, across all accounts. Balances, cushions and rates are edited on the Overview.</p>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
        {spend.map(({ a, s14, s30 }) => (
          <div key={a.id} className="rounded-2xl bg-white px-4 py-3 shadow">
            <p className="text-xs font-semibold text-slate-500 truncate">{a.name} · safe to spend</p>
            <div className="flex gap-5 mt-1">
              <div><p className="text-xl font-bold" style={{ color: safeColor(s14) }}>${formatMoney(s14)}</p><p className="text-[11px] text-slate-400">14 days</p></div>
              <div><p className="text-xl font-bold" style={{ color: safeColor(s30) }}>${formatMoney(s30)}</p><p className="text-[11px] text-slate-400">30 days</p></div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white shadow overflow-hidden">
        <div className="flex items-center justify-between p-5 pb-2 flex-wrap gap-2">
          <h2 className="font-bold text-slate-700">{timelineLabel}</h2>
          <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} aria-label="Account" className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600">
            <option value="">All accounts</option>
            {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <div className="flex items-center gap-3 text-xs">
            {timelineDays !== 14 && <button onClick={() => setTimelineDays(14)} className="text-orange-500 hover:underline">2 Weeks</button>}
            {timelineDays !== 28 && <button onClick={() => setTimelineDays(28)} className="text-orange-500 hover:underline">4 Weeks</button>}
            {timelineDays !== 60 && <button onClick={() => setTimelineDays(60)} className="text-orange-500 hover:underline">60 Days</button>}
            <button onClick={() => setShowAddBill((s) => !s)} className="text-sm font-semibold text-orange-500 hover:underline">{showAddBill ? "Cancel" : "+ Add Transaction"}</button>
          </div>
        </div>

        {showAddBill && (
          <div className="rounded-xl bg-slate-50 p-3 mx-5 mb-3 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-sm text-slate-800 font-semibold mb-1">Account</label>
              <select value={billForm.accountId || accountFilter || cashAccounts[0]?.id || ""} onChange={(e) => setBillForm((f) => ({ ...f, accountId: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:outline-none">
                {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-800 font-semibold mb-1">Name</label>
              <input type="text" value={billForm.name} onChange={(e) => setBillForm((f) => ({ ...f, name: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm text-slate-800 font-semibold mb-1">Estimated Amount</label>
              <input type="number" onFocus={(e) => e.target.select()} value={billForm.estimatedAmount} onChange={(e) => setBillForm((f) => ({ ...f, estimatedAmount: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm text-slate-800 font-semibold mb-1">Direction</label>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden w-fit">
                <button type="button" onClick={() => setBillForm((f) => ({ ...f, direction: "outflow" }))} className="px-3 py-1.5 text-sm font-medium transition" style={billForm.direction === "outflow" ? { backgroundColor: "#e8622a", color: "white" } : { color: "#6b7280" }}>Money Out</button>
                <button type="button" onClick={() => setBillForm((f) => ({ ...f, direction: "inflow" }))} className="px-3 py-1.5 text-sm font-medium transition" style={billForm.direction === "inflow" ? { backgroundColor: "#059669", color: "white" } : { color: "#6b7280" }}>Money In</button>
              </div>
            </div>
            <div>
              <label className="block text-sm text-slate-800 font-semibold mb-1">Priority</label>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden w-fit">
                <button type="button" onClick={() => setBillForm((f) => ({ ...f, essential: true }))} className="px-3 py-1.5 text-sm font-medium transition" style={billForm.essential ? { backgroundColor: "#dc2626", color: "white" } : { color: "#6b7280" }}>Essential</button>
                <button type="button" onClick={() => setBillForm((f) => ({ ...f, essential: false }))} className="px-3 py-1.5 text-sm font-medium transition" style={!billForm.essential ? { backgroundColor: "#64748b", color: "white" } : { color: "#6b7280" }}>Discretionary</button>
              </div>
            </div>
            <div>
              <label className="block text-sm text-slate-800 font-semibold mb-1">Frequency</label>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden w-fit">
                {(["monthly", "biweekly", "weekly", "once"] as BillFrequency[]).map((f) => (
                  <button key={f} type="button" onClick={() => setBillForm((form) => ({ ...form, frequency: f }))} className="px-3 py-1.5 text-sm font-medium transition"
                    style={billForm.frequency === f ? { backgroundColor: "#e8622a", color: "white" } : { color: "#6b7280" }}>{FREQ_LABELS[f]}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm text-slate-800 font-semibold mb-1">{billForm.frequency === "once" ? "Due Date" : "First/Next Due Date"}</label>
              <input type="date" value={billForm.anchorDate} onChange={(e) => setBillForm((f) => ({ ...f, anchorDate: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-slate-800 font-semibold mb-1">Category (optional)</label>
              <input type="text" value={billForm.categoryLabel} onChange={(e) => setBillForm((f) => ({ ...f, categoryLabel: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            </div>
            <button onClick={handleAddBill} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 transition sm:col-span-2" style={{ backgroundColor: "#e8622a" }}>Add</button>
          </div>
        )}

        {editingBillId && (
          <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 mx-5 mb-3 grid gap-2 sm:grid-cols-2">
            <select value={editBillForm.accountId} onChange={(e) => setEditBillForm((f) => ({ ...f, accountId: e.target.value }))} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:outline-none sm:col-span-2" aria-label="Account">
              {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <input type="text" value={editBillForm.name} onChange={(e) => setEditBillForm((f) => ({ ...f, name: e.target.value }))} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            <input type="number" onFocus={(e) => e.target.select()} value={editBillForm.estimatedAmount} onChange={(e) => setEditBillForm((f) => ({ ...f, estimatedAmount: e.target.value }))} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            <div className="flex rounded-lg border border-slate-200 overflow-hidden w-fit">
              <button type="button" onClick={() => setEditBillForm((f) => ({ ...f, direction: "outflow" }))} className="px-3 py-1.5 text-sm font-medium transition" style={editBillForm.direction === "outflow" ? { backgroundColor: "#e8622a", color: "white" } : { color: "#6b7280" }}>Money Out</button>
              <button type="button" onClick={() => setEditBillForm((f) => ({ ...f, direction: "inflow" }))} className="px-3 py-1.5 text-sm font-medium transition" style={editBillForm.direction === "inflow" ? { backgroundColor: "#059669", color: "white" } : { color: "#6b7280" }}>Money In</button>
            </div>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden w-fit">
              <button type="button" onClick={() => setEditBillForm((f) => ({ ...f, essential: true }))} className="px-3 py-1.5 text-sm font-medium transition" style={editBillForm.essential ? { backgroundColor: "#dc2626", color: "white" } : { color: "#6b7280" }}>Essential</button>
              <button type="button" onClick={() => setEditBillForm((f) => ({ ...f, essential: false }))} className="px-3 py-1.5 text-sm font-medium transition" style={!editBillForm.essential ? { backgroundColor: "#64748b", color: "white" } : { color: "#6b7280" }}>Discretionary</button>
            </div>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden w-fit">
              {(["monthly", "biweekly", "weekly", "once"] as BillFrequency[]).map((f) => (
                <button key={f} type="button" onClick={() => setEditBillForm((form) => ({ ...form, frequency: f }))} className="px-3 py-1.5 text-sm font-medium transition"
                  style={editBillForm.frequency === f ? { backgroundColor: "#e8622a", color: "white" } : { color: "#6b7280" }}>{FREQ_LABELS[f]}</button>
              ))}
            </div>
            <input type="date" value={editBillForm.anchorDate} onChange={(e) => setEditBillForm((f) => ({ ...f, anchorDate: e.target.value }))} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            <input type="text" value={editBillForm.categoryLabel} onChange={(e) => setEditBillForm((f) => ({ ...f, categoryLabel: e.target.value }))} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            <div className="flex items-center gap-2 sm:col-span-2">
              <button onClick={handleSaveEditBill} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>Save</button>
              <button onClick={() => setEditingBillId(null)} className="text-sm text-slate-400 hover:underline">Cancel</button>
            </div>
          </div>
        )}

        {visibleOccurrences.length === 0 ? (
          <p className="text-sm text-slate-400 px-5 pb-5">Nothing scheduled — click "+ Add Transaction" above to get started.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="px-5 py-2 font-medium">Date</th>
                  <th className="px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Account</th>
                  <th className="px-2 py-2 font-medium">Amount</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-5 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {visibleOccurrences.map((occ) => {
                  const bill = bills.find((b) => b.id === occ.billId);
                  return (
                    <tr key={`${occ.billId}-${occ.dueDate}`} className="border-b border-slate-50 last:border-0">
                      <td className="px-5 py-2 text-slate-600 whitespace-nowrap">{new Date(occ.dueDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                      <td className="px-2 py-2 font-medium text-slate-700">
                        {occ.direction === "inflow" && <span className="text-emerald-600 mr-1">+</span>}
                        {occ.billName}
                        <span className="text-slate-400 font-normal">{occ.categoryLabel ? ` · ${occ.categoryLabel}` : ""}</span>
                        {!occ.essential && <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">discretionary</span>}
                        {bill && (
                          <span className="ml-1">
                            <button onClick={() => startEditBill(bill)} className="text-xs text-orange-500 hover:underline">Edit</button>{" · "}
                            <button onClick={() => handleDeactivateBill(bill.id)} className="text-xs text-red-400 hover:underline">Remove</button>
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-slate-500 whitespace-nowrap">{acctName(String(occ.cashAccountId))}</td>
                      <td className="px-2 py-2" style={{ color: occ.direction === "inflow" ? "#059669" : "#475569" }}>{occ.direction === "inflow" ? "+" : ""}${formatMoney(occ.amount)}</td>
                      <td className="px-2 py-2">{occ.isPaid ? <span className="text-emerald-600 text-xs font-semibold">✓ Actual</span> : occ.billId.startsWith("stmt:") ? <span className="text-xs font-semibold" style={{ color: "#b45309" }}>Statement due</span> : <span className="text-slate-400 text-xs">Estimated</span>}</td>
                      <td className="px-5 py-2 text-right">
                        {occ.billId.startsWith("stmt:") ? (
                          <span className="text-xs text-slate-400">Mark paid on the Invoices tab</span>
                        ) : markPayingFor?.billId === occ.billId && markPayingFor?.dueDate === occ.dueDate ? (
                          <div className="flex items-center gap-1 justify-end">
                            <input type="number" onFocus={(e) => e.target.select()} value={markAmount} onChange={(e) => setMarkAmount(e.target.value)} className="w-20 rounded border border-slate-200 px-1.5 py-0.5 text-xs focus:outline-none" />
                            <button onClick={handleConfirmMarkPaid} className="text-xs text-white px-2 py-0.5 rounded" style={{ backgroundColor: "#e8622a" }}>Save</button>
                            <button onClick={() => setMarkPayingFor(null)} className="text-xs text-slate-400">✕</button>
                          </div>
                        ) : occ.isPaid ? (
                          <div className="flex items-center gap-2 justify-end">
                            <button onClick={() => startMarkPaid(occ)} className="text-xs text-orange-500 hover:underline">Edit</button>
                            <button onClick={() => handleUnmarkPaid(occ)} className="text-xs text-slate-400 hover:underline">Undo</button>
                          </div>
                        ) : (
                          <button onClick={() => startMarkPaid(occ)} className="text-xs text-orange-500 hover:underline">Mark Actual</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- Credit Cards Panel ----------------

// ---------------- Weekly Review Panel ----------------

// Calls one of the statements routes with the logged-in session. Only used for finance users on this page.
async function statementsPost(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; json: any }> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "x-session-token": getSessionToken() }, body: JSON.stringify(body) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch { return { ok: false, json: {} }; }
}

function OverviewPanel({ staleItems, cashAccounts, cards, charges, allBills, allPayments, latestBalances, onViewArDetails, refreshAll, unpaidInvoices, stmtOut, onOpenTab }: {
  onOpenTab: (tab: string) => void;
  unpaidInvoices: any[]; stmtOut: StatementOutflows;
  refreshAll: () => void; staleItems: StaleItem[]; cashAccounts: CashAccount[]; cards: CreditCard[]; charges: CardCharge[]; allBills: RecurringBill[]; allPayments: BillPayment[];
  latestBalances: Record<string, BalanceCheck>; onViewArDetails: () => void;
}) {
  const [latestReview, setLatestReview] = useState<WeeklyCashReview | null>(null);
  const [history, setHistory] = useState<WeeklyCashReview[]>([]);
  const [latestArAging, setLatestArAging] = useState<ArAgingEntry | null>(null);
  const [bonusObligations, setBonusObligations] = useState<CompOwedResult | null>(null);
  const [overviewGoal, setOverviewGoal] = useState<number | null>(null);
  useEffect(() => {
    loadProductionGoal(new Date().getFullYear()).then((g) => {
      if (g?.annualGoal) setOverviewGoal(g.annualGoal / 12);
    });
  }, []);
  const [avgMonthlyProduction, setAvgMonthlyProduction] = useState<number | null>(null);

  // Chart data. Balances: every entry per account/card/loan (the chart keeps
  // the last one of each week or month). Statements: monthly. Open Dental:
  // monthly production plus the last income entry of each month. A/R: weekly.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Transfer suggestion: where its "Mark done" panel is open ("lead" or a card key), the amount, and a short confirmation.
  const [transferOpenAt, setTransferOpenAt] = useState<string | null>(null);
  const [transferAmt, setTransferAmt] = useState("");
  const [transferMsg, setTransferMsg] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  // Practice cards (Open Dental, A/R): inline Update panels.
  const [practiceOpen, setPracticeOpen] = useState<"od" | "ar" | null>(null);
  const [odForm, setOdForm] = useState({ prod: "", income: "", patient: "" });
  const [arForm, setArForm] = useState({ a0: "", a31: "", a61: "", a90: "", wo: "", ins: "" });
  const [practiceMsg, setPracticeMsg] = useState<Record<string, string>>({});
  const [practiceBusy, setPracticeBusy] = useState(false);
  // Quick entry on each card: balance, statement, and logging a payment, without the guided flow.
  type Quick = { open: boolean; hist: boolean; stm: boolean; bal: string; month: string; stmt: string; payAmt: string; payDate: string; msg: string };
  const blankQuick = (month: string): Quick => ({ open: false, hist: false, stm: false, bal: "", month, stmt: "", payAmt: "", payDate: todayStr(), msg: "" });
  const [quick, setQuick] = useState<Record<string, Quick>>({});
  // Filed statements per card (loaded when its Statements view is opened) and unpaid vendor invoices.
  const [tileStatements, setTileStatements] = useState<Record<string, any[] | null>>({});
  const [balanceHist, setBalanceHist] = useState<Record<string, BalanceCheck[]>>({});
  const [statementPts, setStatementPts] = useState<Record<string, BarPoint[]>>({});
  const [loans, setLoans] = useState<Debt[]>([]);
  // Which account's Edit window is open (bank, card or loan).
  const [editTile, setEditTile] = useState<{ kind: "bank" | "card" | "loan"; key: string; name: string } | null>(null);
  // Which cards are expanded, and which category's "+ Add" window is open.
  const [openTiles, setOpenTiles] = useState<Record<string, boolean>>({});
  const [addKind, setAddKind] = useState<null | "bank" | "card" | "loan">(null);
  const toggleTile = (key: string) => setOpenTiles((o) => ({ ...o, [key]: !o[key] }));
  const [odSeries, setOdSeries] = useState<{ production: BarPoint[]; income: BarPoint[]; patient: BarPoint[]; insurance: BarPoint[] }>({ production: [], income: [], patient: [], insurance: [] });
  const [arPoints, setArPoints] = useState<BarPoint[]>([]);
  useEffect(() => {
    (async () => {
      const loanList = (await loadDebts()).filter((d) => d.kind !== "revolving" && d.active);
      const named = [...cashAccounts, ...cards, ...loanList];
      const [balLists, acctStmts, cardStmts, loanStmts, dental, review, reviews, arHist] = await Promise.all([
        Promise.all(named.map((x) => loadBalanceHistoryForAccount(x.name, 500))),
        Promise.all(cashAccounts.map((a) => loadStatementHistoryForAccount(a.id))),
        Promise.all(cards.map((c) => loadStatementHistoryForCard(c.id))),
        Promise.all(loanList.map((l) => loadDebtStatements(l.id))),
        loadDentalMonthlyHistory(), loadLatestWeeklyReview(), loadWeeklyReviewHistory(120), loadArAgingHistory(80),
      ]);
      const bh: Record<string, BalanceCheck[]> = {};
      named.forEach((x, i) => { bh[x.name] = balLists[i]; });
      setBalanceHist(bh);
      const sp: Record<string, BarPoint[]> = {};
      const toPts = (list: { month: string; balance: number }[]) => list.map((e) => ({ date: e.month, value: e.balance }));
      cashAccounts.forEach((a, i) => { sp[a.id] = toPts(acctStmts[i]); });
      cards.forEach((c, i) => { sp[c.id] = toPts(cardStmts[i]); });
      loanList.forEach((l, i) => { sp[l.id] = toPts(loanStmts[i]); });
      setStatementPts(sp);
      setLoans(loanList);
      setArPoints(arHist.map((e) => ({ date: e.entryDate, value: e.ar0to30 + e.ar31to60 + e.ar61to90 + e.ar90plus })));

      // Income resets every month, so each month shows the LAST entry made in it.
      const lastByMonth = new Map<string, WeeklyCashReview>();
      for (const r of reviews) {
        const k = r.reviewDate.slice(0, 7);
        const prev = lastByMonth.get(k);
        if (!prev || r.reviewDate > prev.reviewDate) lastByMonth.set(k, r);
      }
      const income: BarPoint[] = [], patient: BarPoint[] = [], insurance: BarPoint[] = [];
      lastByMonth.forEach((r, k) => {
        if (r.currentIncome != null) income.push({ date: k, value: r.currentIncome });
        if (r.currentPatientIncome != null) patient.push({ date: k, value: r.currentPatientIncome });
        if (r.currentIncome != null && r.currentPatientIncome != null) insurance.push({ date: k, value: r.currentIncome - r.currentPatientIncome });
      });
      setOdSeries({
        production: withCurrentMonthProjection(dental, review).filter((e) => e.netProduction != null).map((e) => ({ date: e.month, value: e.netProduction as number })),
        income, patient, insurance,
      });
    })();
  }, [cashAccounts, cards]);

  useEffect(() => {
    Promise.all([
      loadLatestWeeklyReview(), loadWeeklyReviewHistory(8), loadLatestArAging(), loadDentalMonthlyHistory(),
      loadStaff(),
    ]).then(async ([latest, hist, ar, dentalHist, staffList]) => {
      // Compensation and bonuses are paid as they are calculated, so the cash
      // position has to know what is owed right now (Dr. Ho, PV, staff growth).
      setBonusObligations(await loadCompOwed(staffList));
      setLatestReview(latest);
      setHistory(hist);
      setLatestArAging(ar);
      setAvgMonthlyProduction(computeAvgMonthlyProduction(dentalHist));
    });
  }, []);

  const today = todayStr();
  const monthStart = today.slice(0, 8) + "01";
  // Unpaid statements count as outflows on their due dates, from the account they'll be paid from.
  const occurrences = [...buildOccurrences(allBills, allPayments, monthStart, addDays(today, 14)), ...stmtOut.occurrences.filter((o) => o.dueDate <= addDays(today, 14))];
  // Works for however many bank accounts are open (it used to assume exactly Fifth Third and Chase).
  const forecasts = cashAccounts.map((a) => computeAccountForecast(a, latestBalances[a.name]?.balance ?? 0, occurrences, today, 0));
  const transfer = computeSuggestedTransferMulti(forecasts);

  // The goal was hardcoded here; it now comes from whatever is set for the
  // year on the Weekly Update tab, falling back to the old figure only
  // until a goal has been entered.
  const productionTarget = overviewGoal ?? 165000;
  const collectionsTarget = 145000;
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthProgress = now.getDate() / daysInMonth;
  const proratedCollectionsTarget = Math.round(collectionsTarget * monthProgress);
  const productionNum = latestReview?.projectedTotalProduction ?? null;
  const incomeNum = latestReview?.currentIncome ?? null;
  const patientIncomeNum = latestReview?.currentPatientIncome ?? null;
  const insuranceIncome = incomeNum != null && patientIncomeNum != null ? incomeNum - patientIncomeNum : null;

  const monthEnd = `${today.slice(0, 8)}${String(daysInMonth).padStart(2, "0")}`;
  // Only what is still unpaid. A bill marked paid has already left the bank
  // balance, so counting it here as well would double-count it and make the
  // number creep UP as the month goes on instead of holding steady.
  const fullMonthOccurrences = buildOccurrences(allBills, allPayments, monthStart, monthEnd).filter((o) => !o.isPaid);
  // A card minimum has to be covered to avoid an overdraft or late fee. When a
  // card's payment is already a scheduled bill this month it is counted with the
  // other obligations; when it isn't, its minimum is added here so it isn't missed.
  const monthAllOccurrences = buildOccurrences(allBills, allPayments, monthStart, monthEnd);
  const unscheduledCardMins = cards
    .filter((c) => c.minimumPayment > 0 && !monthAllOccurrences.some((o) => o.direction === "outflow" && o.linkedCreditCardId === c.id))
    .map((c) => ({ name: c.name, amount: c.minimumPayment }));
  const cardMinTotal = unscheduledCardMins.reduce((sum, c) => sum + c.amount, 0);
  // Vendor invoices not yet paid and not already covered by a scheduled bill. Invoices linked to a scheduled
  // bill are counted through that bill, so they are left out here to avoid counting them twice.
  const openInvoices = unpaidInvoices.filter((i) => !i.paid && !i.matched_bill_id && Number.isFinite(Number(i.amount)));
  const invoiceTotal = openInvoices.reduce((sum, i) => sum + Number(i.amount), 0);
  const coveredCount = unpaidInvoices.filter((i) => !i.paid && i.matched_bill_id).length;
  const invoiceByVendor = Object.entries(openInvoices.reduce<Record<string, number>>((m, i) => { m[i.account_name] = (m[i.account_name] ?? 0) + Number(i.amount); return m; }, {}));
  const owedItems = [
    ...(bonusObligations?.items ?? []),
    ...(invoiceTotal > 0 ? [{
      label: "Unpaid vendor invoices",
      detail: `${openInvoices.length} invoice${openInvoices.length === 1 ? "" : "s"}: ${invoiceByVendor.map(([v, a]) => `${v} $${formatMoney(a)}`).join(", ")}${coveredCount > 0 ? ` (${coveredCount} more covered by scheduled bills)` : ""}. Mark them paid, or link them to a scheduled bill, on the Statements page.${stmtOut.noAccount.count > 0 ? ` ${stmtOut.noAccount.count} ($${formatMoney(stmtOut.noAccount.total)}) have no “paid from” account yet, so they are not in the 14-day outlook.` : ""}${stmtOut.noDueDate.count > 0 ? ` ${stmtOut.noDueDate.count} ($${formatMoney(stmtOut.noDueDate.total)}) have no due date, so they are not in the 14-day outlook.` : ""}`,
      amount: invoiceTotal,
    }] : []),
    ...(cardMinTotal > 0 ? [{ label: "Card minimums not scheduled as bills", detail: unscheduledCardMins.map((c) => `${c.name} $${formatMoney(c.amount)}`).join(", "), amount: cardMinTotal }] : []),
  ];
  const owedTotal = owedItems.reduce((sum, i) => sum + i.amount, 0);
  const requiredCollections = cashAccounts.length > 0
    ? computeRequiredCollectionsMulti(cashAccounts, (a) => latestBalances[a.name]?.balance ?? 0, fullMonthOccurrences, productionNum, owedTotal)
    : null;

  const cardRecs = cards.map((card) => {
    const linkedAccount = cashAccounts.find((a) => a.id === card.linkedCashAccountId);
    let accountForecast = null;
    if (linkedAccount) {
      const accountBills = allBills.filter((b) => b.cashAccountId === linkedAccount.id);
      const accountOccurrences = [...buildOccurrences(accountBills, allPayments, monthStart, addDays(today, WINDOW_DAYS)), ...stmtOut.occurrences.filter((o) => String(o.cashAccountId) === String(linkedAccount.id))];
      accountForecast = computeAccountForecast(linkedAccount, latestBalances[linkedAccount.name]?.balance ?? 0, accountOccurrences, today, 0);
      // If this account's excess is already earmarked for a transfer to the
      // other account, don't also offer it up for card paydown — that would
      // suggest using the same dollars for two different things at once.
      if (accountForecast && transfer && transfer.fromAccountName === linkedAccount.name) {
        accountForecast = { ...accountForecast, excessOrShortfall: Math.max(0, accountForecast.excessOrShortfall - transfer.amount) };
      }
    }
    return computeCardRecommendation(card, latestBalances[card.name]?.balance ?? 0, charges, today, accountForecast);
  });
  const cardAlerts = cardRecs.filter((r) => r.overLimitRisk || r.urgentMinimumDue || r.suggestedExtraPayment > 0);

  const [checkAccountId, setCheckAccountId] = useState("");
  const [checkSelection, setCheckSelection] = useState("");
  const [checkNewName, setCheckNewName] = useState("");
  const [checkNewAmount, setCheckNewAmount] = useState("");
  const [checkNewDate, setCheckNewDate] = useState(todayStr());
  const [checkOverrideAmount, setCheckOverrideAmount] = useState("");
  const [checkResult, setCheckResult] = useState<{ safe: boolean; projectedBalance: number; suggestedDate: string | null; suggestedBalance: number | null; matchedExisting: boolean } | null>(null);

  const checkAccount = cashAccounts.find((a) => a.id === checkAccountId);
  const checkOccurrences = checkAccount
    ? buildOccurrences(allBills.filter((b) => b.cashAccountId === checkAccount.id), allPayments, today, addDays(today, 90))
    : [];
  const upcomingForCheck = checkOccurrences.filter((o) => o.dueDate >= today && !o.isPaid);

  function handleRunCheck() {
    if (!checkAccount) return;
    const balance = latestBalances[checkAccount.name]?.balance ?? 0;
    const minComfortable = checkAccount.cushionTarget;

    if (checkSelection === "new") {
      const amount = Number(checkNewAmount);
      if (!checkNewAmount || isNaN(amount) || !checkNewDate) return;
      const result = checkBillPayment(balance, today, checkOccurrences, amount, checkNewDate, minComfortable);
      setCheckResult({ ...result, matchedExisting: false });
    } else {
      const [billId, dueDate] = checkSelection.split("|");
      const occ = upcomingForCheck.find((o) => o.billId === billId && o.dueDate === dueDate);
      if (!occ) return;
      const amount = checkOverrideAmount ? Number(checkOverrideAmount) : occ.amount;
      const adjusted = checkOverrideAmount
        ? checkOccurrences.map((o) => (o.billId === billId && o.dueDate === dueDate ? { ...o, amount } : o))
        : checkOccurrences;
      const points = projectBalance(balance, today, adjusted, 90);
      const point = points.find((p) => p.date === dueDate) ?? points[points.length - 1];
      const safe = point.balance >= minComfortable;
      setCheckResult({ safe, projectedBalance: point.balance, suggestedDate: null, suggestedBalance: null, matchedExisting: true });
    }
  }

  // ---------------- Warnings: built once, shown in the lead list AND in each card ----------------
  type WarnKind = "act" | "soon" | "suggest" | "update";
  interface Warn { kind: WarnKind; text: string; lead?: boolean; action?: "transfer" }
  const WARN_STYLE: Record<WarnKind, { tag: string; fg: string; bg: string; rank: number }> = {
    act: { tag: "Act now", fg: "#991b1b", bg: "#fee2e2", rank: 0 },
    soon: { tag: "Soon", fg: "#92400e", bg: "#fef3c7", rank: 1 },
    suggest: { tag: "Suggestion", fg: "#1e4e8c", bg: "#dbeafe", rank: 2 },
    update: { tag: "Update", fg: "#991b1b", bg: "#fee2e2", rank: 3 },
  };
  const staleFor = (name: string): Warn[] =>
    (staleItems.find((it) => it.name === name)?.warnings ?? []).map((t) => ({ kind: "update" as const, text: t.charAt(0).toLowerCase() + t.slice(1) + "." }));

  // Chart series: the weekly/monthly balance plus a monthly statement view, toggled on each card.
  const balSeries = (name: string, mode: "week" | "month"): BarSeries => ({
    label: "Balance", mode,
    caption: mode === "week" ? "Balance · last entry each week" : "Balance · last entry each month",
    points: (balanceHist[name] ?? []).map((b) => ({ date: b.checkedAt, value: b.balance })),
  });
  const stmtSeries = (id: string): BarSeries => ({ label: "Statement", mode: "month", caption: "Statement balance · by month covered", points: statementPts[id] ?? [] });
  const latestOf = (pts?: BarPoint[]) => (pts && pts.length ? pts.reduce((a, b) => (b.date > a.date ? b : a)) : null);

  const bankTiles = cashAccounts.map((a) => {
    const bal = latestBalances[a.name];
    const fc = computeAccountForecast(a, bal?.balance ?? 0, occurrences, today, 0);
    const warns: Warn[] = [];
    if (fc.excessOrShortfall < 0) warns.push({ kind: "act", text: `short of its $${formatMoney(fc.cushion)} cushion by $${formatMoney(-fc.excessOrShortfall)} over the next 14 days.` });
    if (transfer && transfer.amount > 0 && transfer.fromAccountName === a.name) warns.push({ kind: "suggest", text: `transfer $${formatMoney(transfer.amount)} to ${transfer.toAccountName}. ${transfer.reason}`, action: "transfer" });
    if (transfer && transfer.amount > 0 && transfer.toAccountName === a.name) warns.push({ kind: "suggest", text: `a $${formatMoney(transfer.amount)} transfer from ${transfer.fromAccountName} is suggested to cover this.`, lead: false, action: "transfer" });
    const stmtTop = latestOf(statementPts[a.id]);
    const stmt = stmtTop ? { month: stmtTop.date, balance: stmtTop.value } : undefined;
    const stats: { k: string; v: string; color?: string }[] = [
      ...(stmt ? [{ k: `Statement ${stmtMonthLabel(stmt.month)}`, v: `$${formatMoney(stmt.balance)}` }] : []),
      { k: "Cushion target", v: `$${formatMoney(fc.cushion)}` },
      { k: "Next 14 days", v: `+$${formatMoney(fc.expectedDeposits14d)} / −$${formatMoney(fc.obligations14d)}` },
      { k: "Excess / (shortfall)", v: formatUSD(fc.excessOrShortfall), color: safeColor(fc.excessOrShortfall) },
    ];
    return { key: a.id, kind: "bank" as const, defaultMonth: previousMonth(), payBill: undefined as RecurringBill | undefined, name: a.name, tag: "Bank account", balance: bal?.balance ?? null, checkedAt: bal?.checkedAt, stats, warns, series: [balSeries(a.name, "week"), stmtSeries(a.id)] };
  });

  const cardTiles = cards.map((c, i) => {
    const rec = cardRecs[i];
    const bal = latestBalances[c.name];
    const warns: Warn[] = [];
    if (rec.overLimitRisk) warns.push({ kind: "act", text: `projected to approach the credit limit within 14 days (est. $${formatMoney(rec.projectedBalance)} of $${formatMoney(c.creditLimit)}) — pay down now.` });
    if (rec.urgentMinimumDue) warns.push({ kind: "soon", text: `payment due in ${rec.daysUntilDue} day${rec.daysUntilDue === 1 ? "" : "s"} — minimum $${formatMoney(c.minimumPayment)}, autopay $${formatMoney(c.autopayAmount)}.` });
    if (!rec.overLimitRisk && !rec.urgentMinimumDue && rec.suggestedExtraPayment > 0) warns.push({ kind: "suggest", text: `spare cash flow available — consider an extra $${formatMoney(rec.suggestedExtraPayment)} payment.` });
    const stmtTop = latestOf(statementPts[c.id]);
    const stmt = stmtTop ? { month: stmtTop.date, balance: stmtTop.value } : undefined;
    const stats: { k: string; v: string; color?: string }[] = [
      { k: stmt ? `Statement ${stmtMonthLabel(stmt.month)}` : "Statement", v: `$${formatMoney(stmt ? stmt.balance : rec.statementBalance)}` },
      { k: "Limit · available", v: `$${formatMoney(c.creditLimit)} · $${formatMoney(rec.availableCredit)}` },
      { k: "Payment due", v: `day ${c.dueDay} (${rec.daysUntilDue}d)`, color: rec.urgentMinimumDue ? "#b45309" : undefined },
      { k: "Projected in 14 days", v: `$${formatMoney(rec.projectedBalance)}`, color: rec.overLimitRisk ? "#b91c1c" : undefined },
    ];
    const cardBill = allBills.find((b) => b.linkedCreditCardId === c.id && b.active);
    if (cardBill) stats.push({ k: "Payment from", v: cashAccounts.find((a) => a.id === cardBill.cashAccountId)?.name ?? "--" });
    return { key: c.id, kind: "card" as const, defaultMonth: coveredMonth(c.approxClosingDay), payBill: cardBill, name: c.name, tag: "Credit card", balance: bal?.balance ?? null, checkedAt: bal?.checkedAt, stats, warns, series: [balSeries(c.name, "week"), stmtSeries(c.id)] };
  });
  const loanTiles = loans.map((l) => {
    const loanBill = allBills.find((b) => b.linkedDebtId === l.id && b.active);
    const bal = latestBalances[l.name];
    const warns: Warn[] = [];
    const stmtTop = latestOf(statementPts[l.id]);
    const stats: { k: string; v: string; color?: string }[] = [
      { k: stmtTop ? `Statement ${stmtMonthLabel(stmtTop.date)}` : "Statement", v: stmtTop ? `$${formatMoney(stmtTop.value)}` : "—" },
      { k: "Rate", v: l.interestRate == null ? "not set" : `${l.interestRate}%${l.rateType ? ` ${l.rateType}` : ""}` },
      { k: "Loan payment", v: `$${formatMoney(l.monthlyPayment)}` },
      ...((l.extraMonthly ?? 0) > 0 ? [
        { k: l.extraLabel || "Additional charge", v: `+$${formatMoney(l.extraMonthly)}` },
        { k: "Total paid monthly", v: `$${formatMoney(l.monthlyPayment + l.extraMonthly)}` },
      ] : []),
      { k: "Paid from", v: loanBill ? (cashAccounts.find((a) => a.id === loanBill.cashAccountId)?.name ?? "scheduled") : "not scheduled" },
    ];
    return { key: l.id, kind: "loan" as const, defaultMonth: previousMonth(), payBill: loanBill, cat: l.category, name: l.name, tag: CATEGORY_SHORT[l.category], balance: bal?.balance ?? l.currentBalance, checkedAt: bal?.checkedAt, stats, warns, series: [balSeries(l.name, "month"), stmtSeries(l.id)] };
  });
  const tiles = [...bankTiles, ...cardTiles, ...loanTiles];

  // Lead list: every account warning, plus anything overdue that isn't an account
  // card (loans, Open Dental numbers, A/R), plus practice-level notes.
  const tileNames = new Set(tiles.map((t) => t.name));
  const leadWarns: { account: string; warn: Warn }[] = [
    ...tiles.flatMap((t) => t.warns.filter((w) => w.lead !== false).map((w) => ({ account: t.name, warn: w }))),
  ];
  if (incomeNum != null && productionNum != null && incomeNum < productionNum * monthProgress * 0.8) {
    leadWarns.push({ account: "Collections", warn: { kind: "soon", text: "lagging materially behind production — consider reviewing insurance A/R aging before discretionary spending." } });
  }
  // Vendor invoices still waiting to be paid. Older than 30 days is flagged as urgent.
  {
    const pending = unpaidInvoices.filter((i: any) => !i.paid);
    if (pending.length > 0) {
      const cutoff = addDays(today, -30);
      const old = pending.filter((i: any) => i.invoice_date && i.invoice_date < cutoff).sort((a: any, b: any) => String(a.invoice_date).localeCompare(String(b.invoice_date)));
      const total = pending.reduce((sum: number, i: any) => sum + (Number(i.amount) || 0), 0);
      const oldest = old[0] ? `${old[0].account_name} ${new Date(old[0].invoice_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "";
      leadWarns.push({
        account: "Vendor invoices",
        warn: { kind: old.length > 0 ? "act" : "soon", text: `${pending.length} unpaid ($${formatMoney(total)})${old.length > 0 ? `, ${old.length} older than 30 days (oldest: ${oldest})` : ""}. Pay them, or link them to a scheduled bill, on the Statements page.` },
      });
    }
  }
  if (requiredCollections && requiredCollections.requiredCollectionRate != null && requiredCollections.requiredCollectionRate > 100) {
    leadWarns.push({ account: "Required collections", warn: { kind: "act", text: "exceed projected production — even collecting everything produced this month wouldn't cover obligations and cushions." } });
  }
  leadWarns.sort((x, y) => WARN_STYLE[x.warn.kind].rank - WARN_STYLE[y.warn.kind].rank);

  const arHealth = latestArAging ? computeArHealth({
    ar0to30: latestArAging.ar0to30, ar31to60: latestArAging.ar31to60, ar61to90: latestArAging.ar61to90, ar90plus: latestArAging.ar90plus, woEstimate: latestArAging.woEstimate,
  }, avgMonthlyProduction) : null;
  const arColor = arHealth ? (arHealth.status === "good" ? "#047857" : arHealth.status === "fair" ? "#b45309" : "#b91c1c") : "#64748b";
  const arLabel = arHealth ? (arHealth.status === "good" ? "Healthy" : arHealth.status === "fair" ? "Needs attention" : "Poor") : "—";

  const kpi = "flex-1 min-w-[190px] rounded-xl bg-white shadow px-4 py-2.5";
  const kpiLabel = "text-[11px] text-slate-500 uppercase tracking-wide font-semibold leading-tight";

  // ---- Grouping helpers ----
  const sumNamed = (names: string[]) => names.reduce((sum, n) => sum + (latestBalances[n]?.balance ?? 0), 0);
  const cardsOwed = sumNamed(cards.map((c) => c.name));
  const loansOwed = loans.reduce((sum, l) => sum + (latestBalances[l.name]?.balance ?? l.currentBalance), 0);
  const loanGroups = [...new Set(loanTiles.map((t) => t.cat))]
    .sort((a, b) => categoryRank(a) - categoryRank(b))
    .map((cat) => {
      const ls = loans.filter((l) => l.category === cat);
      return {
        cat, tiles: loanTiles.filter((t) => t.cat === cat),
        owed: ls.reduce((sum, l) => sum + (latestBalances[l.name]?.balance ?? l.currentBalance), 0),
        payment: ls.reduce((sum, l) => sum + l.monthlyPayment, 0),
      };
    });
  const sectionHeader = (key: string, title: string, summary: string) => (
    <button key={`h-${key}`} onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))} aria-expanded={!collapsed[key]}
      className="w-full flex items-center gap-2 pt-3 text-left">
      <span className="text-slate-400 text-xs w-3">{collapsed[key] ? "▸" : "▾"}</span>
      <h2 className="font-bold text-sm uppercase tracking-wide text-slate-700">{title}</h2>
      <span className="text-xs text-slate-500">{summary}</span>
      <span className="flex-1 border-t border-slate-200 ml-2" />
    </button>
  );
  const subHeader = (title: string, summary: string) => (
    <div key={`s-${title}`} className="flex items-baseline gap-2 pt-1 pl-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</h3>
      <span className="text-xs text-slate-400">{summary}</span>
    </div>
  );

  // A category band: collapses its rows, shows its total, and carries its own "+ Add" button.
  const categoryHeader = (key: string, title: string, count: string, total: string, color: string, tint: string, addLabel: string, onAdd: () => void) => (
    <div key={`c-${key}`} className="flex flex-wrap items-center gap-3 rounded-xl px-4 py-2.5 mt-2" style={{ background: tint }}>
      <button onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))} aria-expanded={!collapsed[key]} className="flex items-center gap-2 text-left" style={{ color }}>
        <span className="text-xs w-3">{collapsed[key] ? "▸" : "▾"}</span>
        <h2 className="font-bold text-base uppercase tracking-wide">{title}</h2>
      </button>
      <span className="text-xs font-semibold text-slate-500">{count}</span>
      <span className="flex-1" />
      <span className="text-lg font-bold" style={{ color }}>{total}</span>
      <button onClick={onAdd} className="rounded-lg border bg-white px-3 py-1 text-xs font-semibold hover:bg-slate-50" style={{ color, borderColor: color }}>{addLabel}</button>
    </div>
  );

  const getQ = (t: { key: string; defaultMonth: string }): Quick => quick[t.key] ?? blankQuick(t.defaultMonth);
  const setQ = (t: { key: string; defaultMonth: string }, patch: Partial<Quick>) =>
    setQuick((st) => ({ ...st, [t.key]: { ...(st[t.key] ?? blankQuick(t.defaultMonth)), ...patch } }));

  // Past balance and statement entries for a card, so a typo can be fixed or an entry removed here.
  const historyColumns = (t: (typeof tiles)[number]): HistColumn[] => [
    {
      title: "Current balance",
      load: async () => (await loadBalanceHistoryForAccount(t.name, 60)).map((b): HistRow => ({
        id: b.id,
        label: new Date(b.checkedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }),
        value: formatUSD(b.balance), amount: b.balance,
        onAmount: (n) => updateBalanceCheckAmount(b.id, n),
        onDelete: () => deleteBalanceCheck(b.id),
      })),
    },
    {
      title: "Statement balance - by month covered",
      load: async () => {
        const list = t.kind === "bank" ? await loadStatementHistoryForAccount(t.key) : t.kind === "card" ? await loadStatementHistoryForCard(t.key) : await loadDebtStatements(t.key);
        return list.map((st): HistRow => ({
          id: st.id, label: stmtMonthLabel(st.month), month: st.month, value: formatUSD(st.balance), amount: st.balance,
          onAmount: (n) => (t.kind === "bank" ? updateBankStatementEntryAmount(st.id, n) : t.kind === "card" ? updateStatementEntryAmount(st.id, n) : updateDebtStatementAmount(st.id, n)),
          onMonth: async (m) => {
            const all = t.kind === "bank" ? await loadStatementHistoryForAccount(t.key) : t.kind === "card" ? await loadStatementHistoryForCard(t.key) : await loadDebtStatements(t.key);
            const clash = all.find((x) => x.month === m && x.id !== st.id);
            if (clash && !confirm(`${stmtMonthLabel(m)} already has a statement on file ($${formatMoney(clash.balance)}). Replace it with $${formatMoney(st.balance)}?`)) return;
            if (t.kind === "bank") { await backfillBankStatementMonth(t.key, m, st.balance); await deleteBankStatementEntry(st.id); }
            else if (t.kind === "card") { await backfillStatementMonth(t.key, m, st.balance); await deleteStatementEntry(st.id); }
            else { await saveDebtStatement(t.key, m, st.balance); await deleteDebtStatement(st.id); }
          },
          onDelete: () => (t.kind === "bank" ? deleteBankStatementEntry(st.id) : t.kind === "card" ? deleteStatementEntry(st.id) : deleteDebtStatement(st.id)),
        }));
      },
    },
  ];

  async function quickBalance(t: (typeof tiles)[number]) {
    const q = getQ(t); const n = Number(q.bal);
    if (q.bal === "" || isNaN(n)) return;
    await addBalanceCheck(t.name, n);
    if (t.kind === "loan") { const loan = loans.find((l) => l.id === t.key); if (loan) await saveDebt({ ...loan, currentBalance: n }); }
    setQ(t, { bal: "", msg: "Balance saved." }); refreshAll();
  }
  async function quickStatement(t: (typeof tiles)[number]) {
    const q = getQ(t); const n = Number(q.stmt);
    if (q.stmt === "" || isNaN(n)) return;
    const r = t.kind === "bank" ? await updateBankStatementBalance(t.key, n, q.month) : t.kind === "card" ? await updateStatementBalance(t.key, n, q.month) : await saveDebtStatement(t.key, q.month, n);
    setQ(t, r.ok ? { stmt: "", msg: `${stmtMonthLabel(q.month)} statement saved.` } : { msg: `Not saved: ${r.error ?? "error"}` });
    if (r.ok) refreshAll();
  }
  async function quickPayment(t: (typeof tiles)[number]) {
    const q = getQ(t); const n = Number(q.payAmt);
    if (q.payAmt === "" || isNaN(n) || n <= 0) return;
    const bill = t.payBill;
    if (!bill) { setQ(t, { msg: "Link a scheduled payment first (use Edit on this card)." }); return; }
    // The payment settles the earliest unpaid occurrence of this bill, so it leaves Need to collect.
    const occ = buildOccurrences([bill], allPayments, addDays(today, -35), monthEnd).filter((o) => !o.isPaid && o.direction === "outflow")[0];
    if (!occ) { setQ(t, { msg: "Nothing unpaid on this payment schedule right now." }); return; }
    await saveBillPayment(bill.id, occ.dueDate, n);
    setQ(t, { payAmt: "", msg: `Payment of $${formatMoney(n)} recorded against ${new Date(occ.dueDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}.` });
    refreshAll();
  }

  // ---------------- Transfer suggestion: mark it done ----------------
  // Recording the transfer moves the amount between the two balances, so the
  // suggestion clears because the numbers now cover the shortfall.
  function openTransfer(where: string) {
    setTransferAmt(transfer && transfer.amount > 0 ? String(transfer.amount) : "");
    setTransferOpenAt(where);
  }
  async function recordTransfer() {
    if (!transfer || !transfer.fromAccountName || !transfer.toAccountName) return;
    const amt = Number(transferAmt);
    if (!transferAmt || isNaN(amt) || amt <= 0) return;
    const from = transfer.fromAccountName, to = transfer.toAccountName;
    setTransferBusy(true);
    const r1 = await addBalanceCheck(from, (latestBalances[from]?.balance ?? 0) - amt);
    if (!r1.ok) { setTransferBusy(false); setTransferMsg(`Not saved: ${r1.error ?? "error"}`); return; }
    const r2 = await addBalanceCheck(to, (latestBalances[to]?.balance ?? 0) + amt);
    setTransferBusy(false);
    setTransferOpenAt(null);
    setTransferMsg(r2.ok
      ? `Recorded $${formatMoney(amt)} moved from ${from} to ${to}.`
      : `${from} was reduced, but ${to} did not save (${r2.error ?? "error"}). Use Update on ${to} to enter its balance.`);
    setTimeout(() => setTransferMsg(""), 12000);
    refreshAll();
  }
  const tBox = "rounded border border-sky-300 bg-sky-50 px-1.5 py-1 text-xs font-semibold text-slate-900 focus:border-orange-400 focus:bg-white focus:outline-none";
  const transferForm = transfer && transfer.amount > 0 && transfer.fromAccountName && transfer.toAccountName ? (
    <div className="rounded-xl bg-slate-50 px-4 py-3 flex flex-wrap items-end gap-3 mt-1.5">
      <div>
        <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">Amount moved ({transfer.fromAccountName} → {transfer.toAccountName})</label>
        <NumInput onFocus={(e) => e.target.select()} value={transferAmt} onChange={(e) => setTransferAmt(e.target.value)} wrap="w-28" className={`${tBox} w-full`} />
      </div>
      <button onClick={recordTransfer} disabled={transferBusy} className="rounded-lg px-3 py-1 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#0f766e" }}>{transferBusy ? "Saving…" : "Record transfer"}</button>
      <button onClick={() => setTransferOpenAt(null)} className="text-xs text-slate-500 hover:underline pb-1">Cancel</button>
      <p className="basis-full text-[11px] text-slate-400">Takes the amount off {transfer.fromAccountName}&apos;s balance and adds it to {transfer.toAccountName}&apos;s. You can still tap Update on either account to enter the exact bank balance.</p>
    </div>
  ) : null;

  // ---------------- Practice cards: inline update ----------------
  const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
  function togglePractice(id: "od" | "ar") {
    if (practiceOpen === id) { setPracticeOpen(null); return; }
    const str = (v: number | null | undefined) => (v == null ? "" : String(v));
    if (id === "od") setOdForm({ prod: str(latestReview?.projectedTotalProduction), income: str(latestReview?.currentIncome), patient: str(latestReview?.currentPatientIncome) });
    else setArForm({ a0: str(latestArAging?.ar0to30), a31: str(latestArAging?.ar31to60), a61: str(latestArAging?.ar61to90), a90: str(latestArAging?.ar90plus), wo: str(latestArAging?.woEstimate), ins: str(latestArAging?.insuranceEstimate) });
    setPracticeMsg((m) => ({ ...m, [id]: "" }));
    setPracticeOpen(id);
  }
  async function reloadPractice() {
    const [rv, ar] = await Promise.all([loadLatestWeeklyReview(), loadLatestArAging()]);
    setLatestReview(rv);
    setLatestArAging(ar);
    refreshAll();
  }
  async function savePracticeOd() {
    const vals = [numOrNull(odForm.prod), numOrNull(odForm.income), numOrNull(odForm.patient)];
    if (vals.some((v) => v != null && isNaN(v))) { setPracticeMsg((m) => ({ ...m, od: "Check the numbers." })); return; }
    setPracticeBusy(true);
    // Notes are carried over so a quick update never wipes them.
    const r = await saveWeeklyReview({ reviewDate: today, projectedTotalProduction: vals[0], currentIncome: vals[1], currentPatientIncome: vals[2], notes: latestReview?.notes ?? "" });
    setPracticeBusy(false);
    if (!r.ok) { setPracticeMsg((m) => ({ ...m, od: `Not saved: ${r.error ?? "error"}` })); return; }
    setPracticeOpen(null);
    setPracticeMsg((m) => ({ ...m, od: "Open Dental numbers saved." }));
    await reloadPractice();
  }
  async function savePracticeAr() {
    const n = (s: string) => (s.trim() === "" ? 0 : Number(s));
    const vals = [n(arForm.a0), n(arForm.a31), n(arForm.a61), n(arForm.a90), n(arForm.wo), n(arForm.ins)];
    if (vals.some((v) => isNaN(v))) { setPracticeMsg((m) => ({ ...m, ar: "Check the numbers." })); return; }
    setPracticeBusy(true);
    const r = await saveArAgingEntry({ entryDate: today, ar0to30: vals[0], ar31to60: vals[1], ar61to90: vals[2], ar90plus: vals[3], woEstimate: vals[4], insuranceEstimate: vals[5] });
    setPracticeBusy(false);
    if (!r.ok) { setPracticeMsg((m) => ({ ...m, ar: `Not saved: ${r.error ?? "error"}` })); return; }
    setPracticeOpen(null);
    setPracticeMsg((m) => ({ ...m, ar: "A/R numbers saved." }));
    await reloadPractice();
  }

  const renderTile = (t: (typeof tiles)[number]) => {
    const isOpen = !!openTiles[t.key];
    const editing = editTile?.key === t.key;
    const statOf = (k: string) => t.stats.find((x) => x.k === k);
    const chipKeys = t.kind === "bank" ? ["Excess / (shortfall)", "Next 14 days"] : t.kind === "card" ? ["Payment due", "Limit · available"] : ["Loan payment", "Paid from"];
    const chips = chipKeys.map(statOf).filter((x): x is { k: string; v: string; color?: string } => !!x);
    const lead = t.warns.find((w) => w.kind !== "update");
    const leadLabel = lead ? (lead.kind === "act" ? "Needs action" : lead.kind === "soon" ? "Due soon" : "Suggestion") : "";
    return (
        <div key={t.key} className="rounded-2xl bg-white shadow overflow-hidden">
          <div role="button" tabIndex={0} aria-expanded={isOpen} onClick={() => toggleTile(t.key)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleTile(t.key); } }}
            className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 cursor-pointer hover:bg-slate-50">
            <div className="flex items-center gap-2 min-w-0" style={{ flex: "1 1 200px" }}>
              <span className="text-slate-400 text-xs w-3">{isOpen ? "▾" : "▸"}</span>
              <div className="min-w-0">
                <h3 className="font-bold text-base text-slate-800 truncate">{t.name}</h3>
                <span className="text-[11px] font-semibold text-slate-500">{t.tag}</span>
              </div>
            </div>
            <div style={{ flex: "0 0 150px" }}>
              <p className="text-2xl font-bold leading-tight" style={{ color: "#4A4238" }}>{t.balance != null ? formatUSD(t.balance) : "—"}</p>
              <p className="text-xs text-slate-500">current balance</p>
            </div>
            {chips.map((c) => (
              <div key={c.k} style={{ flex: "0 0 150px" }}>
                <p className="text-sm font-semibold" style={{ color: c.color ?? "#1e293b" }}>{c.v}</p>
                <p className="text-xs text-slate-500">{c.k}</p>
              </div>
            ))}
            <div className="flex flex-col gap-1 items-start" style={{ flex: "0 0 150px" }}>
              {lead && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ color: WARN_STYLE[lead.kind].fg, background: WARN_STYLE[lead.kind].bg }}>⚠️ {leadLabel}</span>}
              <UpdatedStamp when={t.checkedAt} warnings={t.warns.filter((w) => w.kind === "update").map((w) => w.text)} />
            </div>
          </div>
          {isOpen && (
        <div className="px-5 py-4 space-y-3 border-t border-slate-100" style={{ background: "#faf8f4" }}>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <div className="flex flex-col gap-1.5 min-w-0" style={{ flex: "0 0 270px" }}>
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => setQ(t, { open: !getQ(t).open })} className="rounded-lg px-3 py-1 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>{getQ(t).open ? "Close update" : "Update"}</button>
                <button onClick={() => setEditTile(editing ? null : { kind: t.kind, key: t.key, name: t.name })} className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">{editing ? "Close edit" : "Edit details"}</button>
              </div>
              <div className="flex flex-col gap-0.5 text-xs text-slate-600 mt-0.5">
                {t.stats.map((st) => (
                  <div key={st.k} className="flex justify-between gap-3"><span>{st.k}</span><span className="font-semibold" style={{ color: st.color ?? "#1e293b" }}>{st.v}</span></div>
                ))}
              </div>
            </div>
            <div className="flex-1 min-w-0" style={{ flexBasis: 440 }}>
              <BarChart series={t.series} />
            </div>
          </div>
          {t.warns.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {t.warns.map((w, i) => (
                <span key={i} className="text-xs font-medium rounded-lg px-2.5 py-1" style={{ color: WARN_STYLE[w.kind].fg, background: WARN_STYLE[w.kind].bg }}>⚠️ {w.text.charAt(0).toUpperCase() + w.text.slice(1)}
                  {w.action === "transfer" && <button onClick={() => openTransfer(t.key)} className="ml-2 underline font-semibold">Mark done</button>}
                </span>
              ))}
            </div>
          )}
          {transferOpenAt === t.key && transferForm}
          {getQ(t).open && (() => {
            const q = getQ(t);
            const box = "rounded border border-sky-300 bg-sky-50 px-1.5 py-1 text-xs font-semibold text-slate-900 focus:border-orange-400 focus:bg-white focus:outline-none";
            const lab = "block text-[11px] font-semibold text-slate-500 mb-0.5";
            const go = "rounded-lg px-3 py-1 text-xs font-semibold text-white hover:opacity-90";
            return (
              <div className="rounded-xl bg-slate-50 px-4 py-3 flex flex-wrap items-end gap-x-6 gap-y-3">
                <div>
                  <label className={lab}>Current balance</label>
                  <div className="flex items-center gap-1.5">
                    <NumInput onFocus={(e) => e.target.select()} value={q.bal} onChange={(e) => setQ(t, { bal: e.target.value })} wrap="w-28" className={`${box} w-full`} />
                    <button onClick={() => quickBalance(t)} className={go} style={{ backgroundColor: "#e8622a" }}>Save</button>
                  </div>
                </div>
                <div>
                  <label className={lab}>Statement balance</label>
                  <div className="flex items-center gap-1.5">
                    <MonthSelect value={q.month} onChange={(m) => setQ(t, { month: m })} className="!py-1" />
                    <NumInput onFocus={(e) => e.target.select()} value={q.stmt} onChange={(e) => setQ(t, { stmt: e.target.value })} wrap="w-28" className={`${box} w-full`} />
                    <button onClick={() => quickStatement(t)} className={go} style={{ backgroundColor: "#e8622a" }}>Save</button>
                  </div>
                </div>
                {t.kind !== "bank" && (
                  <div>
                    <label className={lab}>Log a payment{t.payBill ? ` (${t.payBill.name})` : ""}</label>
                    {t.payBill ? (
                      <div className="flex items-center gap-1.5">
                        <NumInput onFocus={(e) => e.target.select()} value={q.payAmt} onChange={(e) => setQ(t, { payAmt: e.target.value })} wrap="w-28" className={`${box} w-full`} />
                        <button onClick={() => quickPayment(t)} className={go} style={{ backgroundColor: "#0f766e" }}>Log payment</button>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400" style={{ maxWidth: 260 }}>{t.kind === "loan" ? "Link a scheduled payment to this loan (Edit on the Numbers tab) to log payments here." : "No scheduled payment is linked to this card."}</p>
                    )}
                  </div>
                )}
                <button onClick={() => setQ(t, { hist: !q.hist })} className="text-xs font-semibold text-orange-500 hover:underline pb-1">{q.hist ? "Hide history" : "History"}</button>
                <button onClick={async () => {
                  const opening = !q.stm; setQ(t, { stm: opening });
                  if (opening) { setTileStatements((m) => ({ ...m, [t.key]: null })); const r = await statementsPost("/api/statements/list", { accountKind: t.kind, accountId: t.key }); setTileStatements((m) => ({ ...m, [t.key]: r.ok ? (r.json.files ?? []) : [] })); }
                }} className="text-xs font-semibold text-orange-500 hover:underline pb-1">{q.stm ? "Hide statements" : "Statements"}</button>
                {q.msg && <p className="text-xs font-semibold text-slate-600 basis-full">{q.msg}</p>}
                {q.hist && <div className="basis-full"><HistoryBlock columns={historyColumns(t)} onChanged={() => refreshAll()} /></div>}
                {q.stm && (
                  <div className="basis-full rounded-lg bg-white px-3 py-2">
                    <p className="text-[11px] font-semibold text-slate-400 mb-1">Filed statements</p>
                    {tileStatements[t.key] == null ? <p className="text-xs text-slate-400">Loading…</p> : tileStatements[t.key]!.length === 0 ? <p className="text-xs text-slate-400">No statements filed for this account yet.</p> : (
                      <div className="max-h-48 overflow-y-auto">
                        {tileStatements[t.key]!.map((f: any) => (
                          <div key={f.id} className="flex items-center gap-3 text-xs leading-6 border-b border-slate-100 last:border-0">
                            <span className="w-16 text-slate-500">{stmtMonthLabel(f.month)}</span>
                            <span className="flex-1 min-w-0 truncate text-slate-700">{f.file_name}</span>
                            <span className="font-semibold text-slate-700 w-24 text-right">{f.amount != null ? formatUSD(Number(f.amount)) : "—"}</span>
                            <button onClick={async () => {
                              const r = await statementsPost("/api/statements/download-url", { id: f.id });
                              if (r.ok && r.json.url) { const a = document.createElement("a"); a.href = r.json.url; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove(); } else setQ(t, { msg: r.json.error ?? "Couldn't open the statement." });
                            }} className="rounded px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: "#0f766e" }}>Download</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button onClick={() => onOpenTab("statements")} className="text-xs font-semibold text-orange-500 hover:underline">File a statement →</button>
                  </div>
                )}
              </div>
            );
          })()}
          {editing && (
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              {t.kind === "loan" ? (
                <DebtPanel creditCards={cards} latestBalances={latestBalances} refreshAll={refreshAll} monthlyCollections={null}
                  cashAccounts={cashAccounts} charges={charges} allBills={allBills} allPayments={allPayments}
                  focusDebtId={t.key} onFocusDone={() => setEditTile(null)} />
              ) : (
                <AccountsPanel allBills={allBills} latestBalances={latestBalances} refreshAll={refreshAll}
                  focus={{ kind: t.kind, id: t.key }} onDone={() => setEditTile(null)} />
              )}
            </div>
          )}
        </div>
          )}
        </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* "+ Add" window for a category: a blank form for a new bank account, card or loan. */}
      {addKind && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-8" style={{ background: "rgba(15,23,42,0.35)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setAddKind(null); }}>
          <div className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg text-slate-800">{addKind === "bank" ? "Add a bank account" : addKind === "card" ? "Add a credit card" : "Add a loan"}</h2>
              <button onClick={() => setAddKind(null)} aria-label="Close" className="text-slate-400 hover:text-slate-700 text-xl leading-none px-2">×</button>
            </div>
            {addKind === "loan" ? (
              <DebtPanel creditCards={cards} latestBalances={latestBalances} refreshAll={refreshAll} monthlyCollections={null}
                cashAccounts={cashAccounts} charges={charges} allBills={allBills} allPayments={allPayments}
                addNew onFocusDone={() => setAddKind(null)} />
            ) : (
              <AccountsPanel allBills={allBills} latestBalances={latestBalances} refreshAll={refreshAll}
                addKind={addKind} onDone={() => setAddKind(null)} />
            )}
          </div>
        </div>
      )}

      {/* 1. Check a bill before paying — one compact row */}
      <div className="rounded-2xl px-5 py-3.5" style={{ background: "#e6f1f9" }}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1" style={{ minWidth: 200 }}>
            <h2 className="font-bold text-sm" style={{ color: "#0c4a6e" }}>Check a Bill Before Paying</h2>
            <p className="text-xs text-slate-500">See whether a scheduled or one-off payment is still safe.</p>
          </div>
          <label className="text-xs font-semibold text-slate-800 flex flex-col gap-0.5">Account
            <select value={checkAccountId} onChange={(e) => { setCheckAccountId(e.target.value); setCheckSelection(""); setCheckResult(null); }}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal focus:outline-none bg-white" style={{ width: 190 }}>
              <option value="">Select an account…</option>
              {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          {checkAccount && (
            <label className="text-xs font-semibold text-slate-800 flex flex-col gap-0.5">Which transaction?
              <select value={checkSelection} onChange={(e) => { setCheckSelection(e.target.value); setCheckResult(null); setCheckOverrideAmount(""); }}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal focus:outline-none bg-white" style={{ width: 260 }}>
                <option value="">Select…</option>
                <option value="new">+ New one-time payment (not yet scheduled)</option>
                {upcomingForCheck.map((o) => (
                  <option key={`${o.billId}|${o.dueDate}`} value={`${o.billId}|${o.dueDate}`}>
                    {o.billName} — ${formatMoney(o.amount)} — {new Date(o.dueDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </option>
                ))}
              </select>
            </label>
          )}
          {checkAccount && checkSelection === "new" && (
            <>
              <input type="text" value={checkNewName} onChange={(e) => setCheckNewName(e.target.value)} placeholder="What is this for?" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" style={{ width: 160 }} />
              <input type="number" onFocus={(e) => e.target.select()} value={checkNewAmount} onChange={(e) => setCheckNewAmount(e.target.value)} placeholder="Amount $" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" style={{ width: 110 }} />
              <input type="date" value={checkNewDate} onChange={(e) => setCheckNewDate(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            </>
          )}
          {checkAccount && checkSelection && checkSelection !== "new" && (
            <input type="number" onFocus={(e) => e.target.select()} value={checkOverrideAmount} onChange={(e) => setCheckOverrideAmount(e.target.value)} placeholder="Override amount $ (optional)" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" style={{ width: 200 }} />
          )}
          {checkAccount && checkSelection && (
            <button onClick={handleRunCheck} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#0369a1" }}>Check</button>
          )}
        </div>
        {checkResult && (
          <div className="mt-2.5 rounded-lg p-2.5" style={{ background: checkResult.safe ? "#d1fae5" : "#fee2e2" }}>
            {checkResult.matchedExisting ? (
              <p className="text-sm" style={{ color: checkResult.safe ? "#065f46" : "#991b1b" }}>
                {checkResult.safe ? "✓ Safe" : "⚠️ Tight"} — this is already on the schedule. Projected balance on that date: <strong>${formatMoney(checkResult.projectedBalance)}</strong> ({checkResult.safe ? "above" : "below"} the cushion).
              </p>
            ) : checkResult.safe ? (
              <p className="text-sm text-emerald-800">✓ Safe to pay as planned. Projected balance afterward: <strong>${formatMoney(checkResult.projectedBalance)}</strong>.</p>
            ) : checkResult.suggestedDate ? (
              <p className="text-sm text-red-800">⚠️ Not safe on that date (would land at ${formatMoney(checkResult.projectedBalance)}). Wait until <strong>{new Date(checkResult.suggestedDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</strong>{checkResult.suggestedBalance != null ? <> (projected ${formatMoney(checkResult.suggestedBalance)})</> : null}.</p>
            ) : (
              <p className="text-sm text-red-800">⚠️ Not safe on that date, and no safer date found in the next 60 days. This may need to wait for more cash flow.</p>
            )}
          </div>
        )}
      </div>

      {/* 2. Needs attention — account first, then the text */}
      <div className="rounded-2xl bg-white shadow px-5 py-3.5">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <h2 className="font-bold text-sm text-slate-700">Needs attention</h2>
          <span className="text-xs text-slate-400">Most urgent first · each also appears in its own card below</span>
        </div>
        {transferMsg && <p className="text-xs font-semibold text-emerald-700 pb-1">✓ {transferMsg}</p>}
        {leadWarns.length === 0 ? (
          <p className="text-sm text-emerald-700 py-1">✓ Nothing needs attention right now.</p>
        ) : leadWarns.map((w, i) => (
          <div key={i} className="border-t border-slate-100">
            <div className="flex items-center gap-2.5 py-1.5 text-sm">
              <span className="shrink-0 text-center text-[11px] font-semibold rounded-full py-0.5" style={{ width: 78, color: WARN_STYLE[w.warn.kind].fg, background: WARN_STYLE[w.warn.kind].bg }}>{WARN_STYLE[w.warn.kind].tag}</span>
              <span className="min-w-0"><strong className="text-slate-800">{w.account}</strong> — {w.warn.text}</span>
              {w.warn.action === "transfer" && <button onClick={() => (transferOpenAt === "lead" ? setTransferOpenAt(null) : openTransfer("lead"))} className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#0f766e" }}>Mark done</button>}
            </div>
            {w.warn.action === "transfer" && transferOpenAt === "lead" && transferForm}
          </div>
        ))}
      </div>

      {/* 3. Practice numbers strip */}
      <div className="flex flex-wrap gap-2.5">
        <div className={kpi}>
          <p className={kpiLabel}>Projected production</p>
          <p className="text-lg font-bold" style={{ color: productionNum != null && productionNum >= productionTarget ? "#059669" : "#f59e0b" }}>{productionNum != null ? `$${formatMoney(productionNum)}` : "—"}</p>
          <p className="text-[11px] text-slate-400">vs ${formatMoney(productionTarget)}/mo</p>
        </div>
        <div className={kpi}>
          <p className={kpiLabel}>Current income</p>
          <p className="text-lg font-bold" style={{ color: incomeNum != null && incomeNum >= proratedCollectionsTarget ? "#059669" : "#f59e0b" }}>{incomeNum != null ? `$${formatMoney(incomeNum)}` : "—"}</p>
          <p className="text-[11px] text-slate-400">vs ${formatMoney(proratedCollectionsTarget)} pace (day {now.getDate()}/{daysInMonth})</p>
        </div>
        <div className={kpi}>
          <p className={kpiLabel}>Insurance income</p>
          <p className="text-lg font-bold text-slate-700">{insuranceIncome != null ? `$${formatMoney(insuranceIncome)}` : "—"}</p>
          <p className="text-[11px] text-slate-400">calculated</p>
        </div>
        <button onClick={onViewArDetails} className={`${kpi} text-left hover:opacity-90`} title="See details on the Numbers tab">
          <p className={kpiLabel}>A/R health</p>
          <p className="text-lg font-bold" style={{ color: arColor }}>{arLabel}</p>
          <p className="text-[11px] text-slate-400">{arHealth ? `True A/R $${formatMoney(arHealth.totalAr)}${arHealth.daysInAr != null ? ` · ${arHealth.daysInAr.toFixed(0)} days` : ""}` : "no A/R entered"}</p>
        </button>
        <div className={kpi}>
          <p className={kpiLabel} title="Unpaid obligations this month + both cushions − what's in the accounts now − inflows already scheduled. It falls as collections land in the accounts and rises if new obligations are added.">Need to collect</p>
          <p className="text-lg font-bold" style={{ color: requiredCollections?.requiredCollectionRate != null && requiredCollections.requiredCollectionRate > 100 ? "#dc2626" : "#059669" }}>{requiredCollections && productionNum != null ? `$${formatMoney(requiredCollections.requiredCollections)}` : "—"}</p>
          <p className="text-[11px] text-slate-400">{requiredCollections?.requiredCollectionRate != null ? `${requiredCollections.requiredCollectionRate.toFixed(0)}% of projected production` : "enter projected production"}</p>
        </div>
      </div>

      {requiredCollections && (
        <div className="rounded-xl px-4 py-2.5 bg-white border border-slate-100 shadow-sm">
          <p className="text-xs text-slate-500">
            ${formatMoney(requiredCollections.totalObligations)} in unpaid obligations this month + ${formatMoney(requiredCollections.totalCushions)} cushions − ${formatMoney(requiredCollections.combinedCurrentBalance)} on hand{requiredCollections.knownInflows > 0 ? ` − $${formatMoney(requiredCollections.knownInflows)} already scheduled` : ""}.
          </p>
          {/* Compensation, bonuses and unscheduled card minimums are part of the
              obligations figure above; they're listed because no bill arrives for them. */}
          {owedItems.length > 0 && (
            <div className="mt-1.5 rounded-lg px-3 py-2" style={{ background: "#FAEEDA" }}>
              <p className="text-xs font-semibold mb-0.5" style={{ color: "#854F0B" }}>Compensation, bonuses and minimums owed -- included above</p>
              {owedItems.map((item) => (
                <div key={item.label} className="flex items-start justify-between gap-3 text-xs" style={{ color: "#854F0B" }}>
                  <span>{item.label} <span className="opacity-70">· {item.detail}</span></span>
                  <span className="font-semibold whitespace-nowrap">${formatMoney(item.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Totals, then one band per category: bank accounts, credit cards, loans. Each row opens in place. */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        <div className="rounded-2xl bg-white shadow px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cash on hand</p>
          <p className="text-2xl font-bold" style={{ color: "#0f766e" }}>${formatMoney(sumNamed(cashAccounts.map((a) => a.name)))}</p>
          <p className="text-xs text-slate-500">{bankTiles.length} bank account{bankTiles.length === 1 ? "" : "s"}</p>
        </div>
        <div className="rounded-2xl bg-white shadow px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Owed</p>
          <p className="text-2xl font-bold" style={{ color: "#b45309" }}>${formatMoney(cardsOwed + loansOwed)}</p>
          <p className="text-xs text-slate-500">cards ${formatMoney(cardsOwed)} · loans ${formatMoney(loansOwed)}</p>
        </div>
        <div className="rounded-2xl bg-white shadow px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Needs updating</p>
          <p className="text-2xl font-bold" style={{ color: staleItems.length > 0 ? "#b45309" : "#15803d" }}>{cashAccounts.length > 0 ? staleItems.length : 0}</p>
          <p className="text-xs text-slate-500 truncate">{staleItems.length > 0 ? staleItems.map((i) => i.name).join(", ") : "All up to date"}</p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={() => setOpenTiles(Object.fromEntries(tiles.map((t) => [t.key, true])))} className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Expand all</button>
        <button onClick={() => { setOpenTiles({}); setEditTile(null); }} className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Collapse all</button>
      </div>

      {categoryHeader("accounts", "Bank accounts", `${bankTiles.length} account${bankTiles.length === 1 ? "" : "s"}`, `$${formatMoney(sumNamed(cashAccounts.map((a) => a.name)))}`, "#0f766e", "#e4f2f0", "+ Add bank account", () => setAddKind("bank"))}
      {!collapsed.accounts && bankTiles.map(renderTile)}

      {categoryHeader("cards", "Credit cards", `${cardTiles.length} card${cardTiles.length === 1 ? "" : "s"}`, `$${formatMoney(cardsOwed)} owed`, "#1d5f94", "#e4eef7", "+ Add credit card", () => setAddKind("card"))}
      {!collapsed.cards && cardTiles.map(renderTile)}

      {categoryHeader("loans", "Loans", `${loanTiles.length} loan${loanTiles.length === 1 ? "" : "s"}`, `$${formatMoney(loansOwed)} owed`, "#92400e", "#f8ece0", "+ Add loan", () => setAddKind("loan"))}
      {!collapsed.loans && loanGroups.map((g) => (
        <Fragment key={g.cat}>
          {subHeader(CATEGORY_LABEL[g.cat], `$${formatMoney(g.owed)} owed · $${formatMoney(g.payment)}/mo`)}
          {g.tiles.map(renderTile)}
        </Fragment>
      ))}

      {sectionHeader("practice", "Practice", "Open Dental and accounts receivable")}

      {!collapsed.practice && (
      <div className="flex flex-wrap gap-3">
        {([
          {
            id: "od" as const, title: "Open Dental", warns: [] as Warn[], when: latestReview?.reviewDate,
            series: [
              { label: "Net production", mode: "month", points: odSeries.production, caption: "Monthly · current month is the projection" },
              { label: "Income", mode: "month", points: odSeries.income, caption: "Last income entry of each month (current month is month-to-date)" },
              { label: "Patient", mode: "month", points: odSeries.patient, caption: "Last patient income entry of each month" },
              { label: "Insurance", mode: "month", points: odSeries.insurance, caption: "Last insurance income entry of each month" },
            ] as BarSeries[],
          },
          {
            id: "ar" as const, title: "Accounts receivable", warns: [] as Warn[], when: latestArAging?.entryDate,
            series: [{ label: "Total A/R", mode: "week", points: arPoints, caption: "Total A/R · last entry each week" }] as BarSeries[],
          },
        ]).map((c) => {
          const box = "rounded border border-sky-300 bg-sky-50 px-1.5 py-1 text-xs font-semibold text-slate-900 focus:border-orange-400 focus:bg-white focus:outline-none";
          const lab = "block text-[11px] font-semibold text-slate-500 mb-0.5";
          const field = (label: string, value: string, onChange: (v: string) => void) => (
            <div key={label}>
              <label className={lab}>{label}</label>
              <NumInput onFocus={(e) => e.target.select()} value={value} onChange={(e) => onChange(e.target.value)} wrap="w-28" className={`${box} w-full`} />
            </div>
          );
          return (
          <div key={c.title} className="rounded-2xl bg-white shadow px-5 py-4 space-y-2" style={{ flex: "1 1 520px", minWidth: 0 }}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-slate-800">{c.title}</h3>
                <button onClick={() => togglePractice(c.id)} className="text-xs font-semibold text-orange-500 hover:underline">{practiceOpen === c.id ? "Close" : "Update"}</button>
              </div>
              <UpdatedStamp when={c.when} warnings={c.warns.map((w) => w.text)} />
            </div>
            {practiceOpen === c.id && (
              <div className="rounded-xl bg-slate-50 px-4 py-3 flex flex-wrap items-end gap-x-5 gap-y-3">
                {c.id === "od" ? (
                  <>
                    {field("Projected production", odForm.prod, (v) => setOdForm((f) => ({ ...f, prod: v })))}
                    {field("Current income", odForm.income, (v) => setOdForm((f) => ({ ...f, income: v })))}
                    {field("Patient income", odForm.patient, (v) => setOdForm((f) => ({ ...f, patient: v })))}
                    <p className="text-[11px] text-slate-400 pb-1.5">Insurance income is calculated.</p>
                  </>
                ) : (
                  <>
                    {field("0–30 days", arForm.a0, (v) => setArForm((f) => ({ ...f, a0: v })))}
                    {field("31–60 days", arForm.a31, (v) => setArForm((f) => ({ ...f, a31: v })))}
                    {field("61–90 days", arForm.a61, (v) => setArForm((f) => ({ ...f, a61: v })))}
                    {field("90+ days", arForm.a90, (v) => setArForm((f) => ({ ...f, a90: v })))}
                    {field("Write-off estimate", arForm.wo, (v) => setArForm((f) => ({ ...f, wo: v })))}
                    {field("Insurance estimate", arForm.ins, (v) => setArForm((f) => ({ ...f, ins: v })))}
                  </>
                )}
                <button onClick={c.id === "od" ? savePracticeOd : savePracticeAr} disabled={practiceBusy} className="rounded-lg px-3 py-1 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>{practiceBusy ? "Saving…" : "Save"}</button>
                {practiceMsg[c.id] && <p className="text-xs font-semibold text-slate-600 basis-full">{practiceMsg[c.id]}</p>}
              </div>
            )}
            {practiceOpen !== c.id && practiceMsg[c.id] && <p className="text-xs font-semibold text-emerald-700">✓ {practiceMsg[c.id]}</p>}
            <BarChart series={c.series} />
            {c.warns.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {c.warns.map((w, i) => (
                  <span key={i} className="text-xs font-medium rounded-lg px-2.5 py-1" style={{ color: WARN_STYLE[w.kind].fg, background: WARN_STYLE[w.kind].bg }}>⚠️ {w.text.charAt(0).toUpperCase() + w.text.slice(1)}</span>
                ))}
              </div>
            )}
          </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

// ---------------- Main Page ----------------

export default function CashFlowPage() {
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [cardCharges, setCardCharges] = useState<CardCharge[]>([]);
  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [payments, setPayments] = useState<BillPayment[]>([]);
  const [latestBalances, setLatestBalances] = useState<Record<string, BalanceCheck>>({});
  const [latestReviewForTabs, setLatestReviewForTabs] = useState<WeeklyCashReview | null>(null);
  // Extra data the overdue rules need: loans, every statement log, latest A/R date.
  const [staleData, setStaleData] = useState<{ loans: Debt[]; statements: Record<string, { month: string; balance: number }[]>; arDate: string | null; ar: ArAgingEntry | null }>({ loans: [], statements: {}, arDate: null, ar: null });
  const [flowOpen, setFlowOpen] = useState(false);
  // Setup and history windows opened from the Overview (these used to live on the Numbers tab).
  const [manage, setManage] = useState<null | "accounts" | "debt" | "charges" | "goal" | "backfill" | "record">(null);
  // Unpaid vendor statements: they count as outflows on their due dates in the cash outlook.
  const [unpaidInvoices, setUnpaidInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("");
  // Debt service is only meaningful against what the practice actually
  // collects, so the register is given the recent monthly average.
  const [debtMonthlyCollections, setDebtMonthlyCollections] = useState<number | null>(null);
  useEffect(() => {
    Promise.all([loadDentalMonthlyHistory(), loadLatestWeeklyReview()]).then(([history, review]) => {
      setDebtMonthlyCollections(computeAvgMonthlyProduction(withCurrentMonthProjection(history, review)));
    });
  }, []);

  useEffect(() => { refresh(); }, []);

  // quiet = reload the data without blanking the page, so open histories and
  // expanded rows on the Weekly Update tab stay put after a save.
  async function refresh(quiet = false) {
    if (!quiet) setLoading(true);
    const today = todayStr();
    const monthStart = today.slice(0, 8) + "01";
    const rangeEnd = addDays(today, WINDOW_DAYS);
    const [accounts, cards, charges, b, p, bal, review] = await Promise.all([
      loadCashAccounts(), loadCreditCards(), loadCardCharges(), loadRecurringBills(), loadBillPayments(monthStart, rangeEnd), loadLatestBalances(), loadLatestWeeklyReview(),
    ]);
    statementsPost("/api/statements/list", { docType: "invoice", unpaid: true }).then((r) => { if (r.ok) setUnpaidInvoices(r.json.files ?? []); });
    setCashAccounts(accounts);
    setCreditCards(cards);
    setCardCharges(charges);
    setBills(b);
    setPayments(p);
    setLatestBalances(bal);
    setLatestReviewForTabs(review);
    {
      const loans = (await loadDebts()).filter((d) => d.kind !== "revolving");
      const [acctStmts, cardStmts, loanStmts, ar] = await Promise.all([
        Promise.all(accounts.map((a) => loadStatementHistoryForAccount(a.id))),
        Promise.all(cards.map((c) => loadStatementHistoryForCard(c.id))),
        Promise.all(loans.map((l) => loadDebtStatements(l.id))),
        loadLatestArAging(),
      ]);
      const statements: Record<string, { month: string; balance: number }[]> = {};
      accounts.forEach((a, i) => { statements[a.id] = acctStmts[i]; });
      cards.forEach((c, i) => { statements[c.id] = cardStmts[i]; });
      loans.forEach((l, i) => { statements[l.id] = loanStmts[i]; });
      setStaleData({ loans, statements, arDate: ar?.entryDate ?? null, ar });
    }
    if (!activeTab) setActiveTab("overview");
    setLoading(false);
  }

  // One set of overdue rules (src/lib/staleness.ts) drives this tab flag, the
  // Overview banner, the lines on the Weekly Update tab and the digest email.
  const stmtOut = buildStatementOccurrences(unpaidInvoices, todayStr(), addDays(todayStr(), WINDOW_DAYS));
  const staleItems: StaleItem[] = buildStaleItems({
    accounts: cashAccounts.map((a) => ({ id: a.id, name: a.name })),
    cards: creditCards.map((c) => ({ id: c.id, name: c.name, approxClosingDay: c.approxClosingDay })),
    loans: staleData.loans.map((l) => ({ id: l.id, name: l.name })),
    latestChecked: Object.fromEntries(Object.entries(latestBalances).map(([k, v]) => [k, v.checkedAt])),
    statements: staleData.statements,
    reviewDate: latestReviewForTabs?.reviewDate ?? null,
    arDate: staleData.arDate,
  });
  const dueCount = cashAccounts.length > 0 ? staleItems.length : 0;

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-24 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <header className="mb-4">
          <h1 className="text-2xl font-bold">Cash Flow</h1>
          <p className="text-sm text-slate-500 mt-1">Fifth Third and Chase, tracked independently, plus credit card capacity and the weekly Friday review.</p>
        </header>

        {!loading && (
          <div className="max-w-5xl mb-4">
            <button onClick={() => setFlowOpen(true)}
              className="w-full flex items-center justify-between gap-3 rounded-2xl px-5 py-3.5 text-white shadow hover:opacity-95 transition text-left"
              style={{ background: "#0f766e" }}>
              <span className="font-bold" style={{ fontSize: 17 }}>Update Numbers Now</span>
              <span className="text-sm font-semibold rounded-full px-3 py-1" style={{ background: "rgba(255,255,255,0.22)" }}>
                {dueCount > 0 ? `${dueCount} due` : "All up to date"}
              </span>
            </button>
          </div>
        )}

        {loading ? <p className="text-slate-400 text-sm">Loading…</p> : (
          <div className={activeTab === "overview" || activeTab === "bills" ? "max-w-5xl" : "max-w-7xl"}>
            <div className="mb-4 flex flex-wrap gap-2">
              {([["overview", "Overview & Trends"], ["statements", "Statements"], ["invoices", "Invoices"], ["bills", "Scheduled bills"], ["checks", "Check register"], ["package", "CPA package"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setActiveTab(k)} className="px-4 py-2 text-sm font-semibold transition rounded-lg border-2"
                  style={activeTab === k ? { backgroundColor: "#e8622a", color: "white", borderColor: "#e8622a" } : { backgroundColor: "#d1fae5", color: "#065f46", borderColor: "#065f46" }}>{label}</button>
              ))}
            </div>

            <UpdateNumbersFlow open={flowOpen} onClose={() => setFlowOpen(false)} onSaved={() => refresh(true)}
              accounts={cashAccounts} cards={creditCards} loans={staleData.loans} latestBalances={latestBalances}
              statements={staleData.statements} review={latestReviewForTabs} ar={staleData.ar} dueNames={staleItems.map((i) => i.name)} />

            {activeTab === "statements" && <StatementsMonth finance section="statements" onChanged={() => refresh(true)} />}
            {activeTab === "invoices" && <StatementsMonth finance section="bills" onChanged={() => refresh(true)} />}
            {activeTab === "bills" && (
              <ScheduledBillsPanel cashAccounts={cashAccounts} allBills={bills} allPayments={payments} stmtOcc={stmtOut.occurrences} latestBalances={latestBalances} cards={creditCards} refreshAll={refresh} />
            )}
            {activeTab === "checks" && <StatementsApp forcedTab="checks" embedded />}
            {activeTab === "package" && <StatementsApp forcedTab="package" embedded />}
            {activeTab === "overview" && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-white shadow px-4 py-2.5">
                <span className="text-xs font-bold text-slate-500 mr-1">Set up &amp; history</span>
                {([["charges", "Card charges"], ["goal", "Annual goal"], ["backfill", "Past months"], ["record", "Open Dental & A/R record"]] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setManage(k)} className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">{label}</button>
                ))}
              </div>
            )}
            {manage && (
              <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-8" style={{ background: "rgba(15,23,42,0.35)" }}
                onClick={(e) => { if (e.target === e.currentTarget) setManage(null); }}>
                <div className="w-full max-w-4xl rounded-2xl bg-white p-5 shadow-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-bold text-lg text-slate-800">
                      {manage === "accounts" ? "Bank accounts and credit cards" : manage === "debt" ? "Loans & debt" : manage === "charges" ? "Card charges" : manage === "goal" ? "Annual production goal" : manage === "backfill" ? "Backfill past months" : "Open Dental & A/R record"}
                    </h2>
                    <button onClick={() => setManage(null)} aria-label="Close" className="text-slate-400 hover:text-slate-700 text-xl leading-none px-2">×</button>
                  </div>
                  <WeeklyUpdatePanel section={manage} cashAccounts={cashAccounts} cards={creditCards} latestBalances={latestBalances} refreshAll={() => refresh(true)}
                    charges={cardCharges} allBills={bills} allPayments={payments} loans={staleData.loans}
                    debtMonthlyCollections={debtMonthlyCollections} />
                </div>
              </div>
            )}
            {activeTab === "overview" && (
              <OverviewPanel unpaidInvoices={unpaidInvoices} stmtOut={stmtOut} refreshAll={() => refresh(true)} staleItems={staleItems} cashAccounts={cashAccounts} cards={creditCards} charges={cardCharges} allBills={bills} allPayments={payments} latestBalances={latestBalances} onViewArDetails={() => setManage("record")} onOpenTab={setActiveTab} />
            )}
          </div>
        )}
      </div>
    </main>
  );
}
