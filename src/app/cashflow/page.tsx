"use client";

import { useState, useEffect, Fragment } from "react";
import { Sidebar } from "@/components/Sidebar";
import { formatMoney, formatUSD } from "@/lib/format";
import WeeklyUpdatePanel from "@/components/WeeklyUpdatePanel";
import UpdateNumbersFlow from "@/components/UpdateNumbersFlow";
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
  buildOccurrences, computeSafeToSpend, addDays, checkBillPayment, projectBalance,
  computeAccountForecast, computeSuggestedTransfer, computeCardRecommendation, computeRequiredCollections,
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

function BalanceHistoryList({ accountName, refreshAll }: { accountName: string; refreshAll: () => void }) {
  const [showing, setShowing] = useState(false);
  const [entries, setEntries] = useState<BalanceCheck[]>([]);

  async function load() {
    const hist = await loadBalanceHistoryForAccount(accountName, 15);
    setEntries(hist);
  }

  async function toggle() {
    if (!showing) await load();
    setShowing((s) => !s);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this balance entry? This can't be undone.")) return;
    await deleteBalanceCheck(id);
    await load();
    refreshAll();
  }

  return (
    <div className="mt-2">
      <button onClick={toggle} className="text-xs text-orange-500 hover:underline">{showing ? "Hide history" : "View history"}</button>
      {showing && (
        <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
          {entries.length === 0 ? (
            <p className="text-xs text-slate-400">No entries yet.</p>
          ) : entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-1.5">
              <span className="text-slate-600">{new Date(e.checkedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              <span className="flex items-center gap-2">
                <span className="font-semibold text-slate-700">${formatMoney(e.balance)}</span>
                <button onClick={() => handleDelete(e.id)} className="text-red-400 hover:underline">Delete</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountPanel({ account, allBills, allPayments, latestBalances, cards, refreshAll }: {
  account: CashAccount; allBills: RecurringBill[]; allPayments: BillPayment[];
  latestBalances: Record<string, BalanceCheck>; cards: CreditCard[]; refreshAll: () => void;
}) {
  const [balanceInput, setBalanceInput] = useState("");
  const [cushionInput, setCushionInput] = useState(String(account.cushionTarget));
  const [timelineDays, setTimelineDays] = useState(14);
  const [showAddBill, setShowAddBill] = useState(false);
  const emptyForm = { name: "", estimatedAmount: "", frequency: "monthly" as BillFrequency, anchorDate: todayStr(), category: "bill" as BillCategory, categoryLabel: "", direction: "outflow" as "outflow" | "inflow", essential: true };
  const [billForm, setBillForm] = useState(emptyForm);
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [editBillForm, setEditBillForm] = useState(emptyForm);
  const [markPayingFor, setMarkPayingFor] = useState<{ billId: string; dueDate: string } | null>(null);
  const [markAmount, setMarkAmount] = useState("");

  const today = todayStr();
  const monthStart = today.slice(0, 8) + "01";
  const bills = allBills.filter((b) => b.cashAccountId === account.id);
  const occurrences = buildOccurrences(bills, allPayments, monthStart, addDays(today, WINDOW_DAYS));
  const currentBalance = latestBalances[account.name]?.balance ?? 0;
  const safeToSpend14 = computeSafeToSpend(currentBalance, today, occurrences, 14);
  const safeToSpend30 = computeSafeToSpend(currentBalance, today, occurrences, 30);
  const visibleOccurrences = occurrences.filter((occ) => occ.dueDate <= addDays(today, timelineDays));
  const timelineLabel = timelineDays <= 14 ? "Next 2 Weeks" : timelineDays <= 28 ? "Next 4 Weeks" : `Next ${timelineDays} Days`;
  const linkedCards = cards.filter((c) => c.linkedCashAccountId === account.id);

  async function handleUpdateBalance() {
    const amount = Number(balanceInput);
    if (!balanceInput || isNaN(amount)) return;
    await addBalanceCheck(account.name, amount);
    setBalanceInput("");
    refreshAll();
  }

  async function handleSaveCushion() {
    const amount = Number(cushionInput);
    if (!cushionInput || isNaN(amount)) return;
    await updateCashAccountCushion(account.id, amount);
    refreshAll();
  }

  async function handleAddBill() {
    const amount = Number(billForm.estimatedAmount);
    if (!billForm.name.trim() || !amount || !billForm.anchorDate) return;
    await addRecurringBill({
      name: billForm.name.trim(), estimatedAmount: amount, frequency: billForm.frequency,
      anchorDate: billForm.anchorDate, category: billForm.category, categoryLabel: billForm.categoryLabel.trim() || undefined,
      active: true, cashAccountId: account.id, direction: billForm.direction, essential: billForm.essential,
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
    setEditBillForm({ name: b.name, estimatedAmount: String(b.estimatedAmount), frequency: b.frequency, anchorDate: b.anchorDate, category: b.category, categoryLabel: b.categoryLabel ?? "", direction: b.direction, essential: b.essential });
  }

  async function handleSaveEditBill() {
    if (!editingBillId) return;
    const amount = Number(editBillForm.estimatedAmount);
    if (!editBillForm.name.trim() || !amount || !editBillForm.anchorDate) return;
    await updateRecurringBill(editingBillId, {
      name: editBillForm.name.trim(), estimatedAmount: amount, frequency: editBillForm.frequency,
      anchorDate: editBillForm.anchorDate, category: editBillForm.category, categoryLabel: editBillForm.categoryLabel.trim() || undefined,
      direction: editBillForm.direction, essential: editBillForm.essential,
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
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl p-5 shadow" style={{ background: `linear-gradient(135deg, ${safeColor(safeToSpend14)}22, ${safeColor(safeToSpend14)}44)` }}>
          <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Safe to Spend (14 days)</p>
          <p className="text-3xl font-bold mt-1" style={{ color: safeColor(safeToSpend14) }}>${formatMoney(safeToSpend14)}</p>
        </div>
        <div className="rounded-2xl p-5 shadow" style={{ background: `linear-gradient(135deg, ${safeColor(safeToSpend30)}22, ${safeColor(safeToSpend30)}44)` }}>
          <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Safe to Spend (30 days)</p>
          <p className="text-3xl font-bold mt-1" style={{ color: safeColor(safeToSpend30) }}>${formatMoney(safeToSpend30)}</p>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow">
        <h2 className="font-bold text-slate-700 mb-3 text-sm">{account.name} Balance</h2>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <div>
            <p className="text-2xl font-bold text-slate-700">${formatMoney(currentBalance)}</p>
            <p className="text-xs text-slate-400">
              {latestBalances[account.name] ? `Checked ${new Date(latestBalances[account.name].checkedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : (
                <span className="text-amber-600 font-semibold">⚠️ Update due — no balance entered yet</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input type="number" onFocus={(e) => e.target.select()} value={balanceInput || String(currentBalance)} onChange={(e) => setBalanceInput(e.target.value)} placeholder="New balance"
              className="w-32 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            <button onClick={handleUpdateBalance} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>Update</button>
          </div>
        </div>
        <BalanceHistoryList accountName={account.name} refreshAll={refreshAll} />
        <div className="pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-500 mb-1">Operating cushion. Currently: <strong>${formatMoney(account.cushionTarget)}</strong></p>
          <div className="flex items-center gap-2 max-w-xs">
            <input type="number" onFocus={(e) => e.target.select()} value={cushionInput} onChange={(e) => setCushionInput(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            <button onClick={handleSaveCushion} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>Save</button>
          </div>
        </div>
        {linkedCards.length > 0 && (
          <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-100">Pays: {linkedCards.map((c) => c.name).join(", ")}</p>
        )}
      </div>

      <div className="rounded-2xl bg-white shadow overflow-hidden">
        <div className="flex items-center justify-between p-5 pb-2 flex-wrap gap-2">
          <h2 className="font-bold text-slate-700">{timelineLabel}</h2>
          <div className="flex items-center gap-3 text-xs">
            {timelineDays !== 14 && <button onClick={() => setTimelineDays(14)} className="text-orange-500 hover:underline">2 Weeks</button>}
            {timelineDays !== 28 && <button onClick={() => setTimelineDays(28)} className="text-orange-500 hover:underline">4 Weeks</button>}
            {timelineDays !== 60 && <button onClick={() => setTimelineDays(60)} className="text-orange-500 hover:underline">60 Days</button>}
            <button onClick={() => setShowAddBill((s) => !s)} className="text-sm font-semibold text-orange-500 hover:underline">{showAddBill ? "Cancel" : "+ Add Transaction"}</button>
          </div>
        </div>

        {showAddBill && (
          <div className="rounded-xl bg-slate-50 p-3 mx-5 mb-3 grid gap-3 sm:grid-cols-2">
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
                      <td className="px-2 py-2" style={{ color: occ.direction === "inflow" ? "#059669" : "#475569" }}>{occ.direction === "inflow" ? "+" : ""}${formatMoney(occ.amount)}</td>
                      <td className="px-2 py-2">{occ.isPaid ? <span className="text-emerald-600 text-xs font-semibold">✓ Actual</span> : <span className="text-slate-400 text-xs">Estimated</span>}</td>
                      <td className="px-5 py-2 text-right">
                        {markPayingFor?.billId === occ.billId && markPayingFor?.dueDate === occ.dueDate ? (
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

function OverviewPanel({ staleItems, cashAccounts, cards, charges, allBills, allPayments, latestBalances, onViewArDetails, refreshAll }: {
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
  // Quick entry on each card: balance, statement, and logging a payment, without the guided flow.
  type Quick = { open: boolean; hist: boolean; stm: boolean; bal: string; month: string; stmt: string; payAmt: string; payDate: string; msg: string };
  const blankQuick = (month: string): Quick => ({ open: false, hist: false, stm: false, bal: "", month, stmt: "", payAmt: "", payDate: todayStr(), msg: "" });
  const [quick, setQuick] = useState<Record<string, Quick>>({});
  // Filed statements per card (loaded when its Statements view is opened) and unpaid vendor invoices.
  const [tileStatements, setTileStatements] = useState<Record<string, any[] | null>>({});
  const [unpaidInvoices, setUnpaidInvoices] = useState<any[]>([]);
  useEffect(() => {
    statementsPost("/api/statements/list", { docType: "invoice", unpaid: true }).then((r) => { if (r.ok) setUnpaidInvoices(r.json.files ?? []); });
  }, [cashAccounts, cards]);
  const [balanceHist, setBalanceHist] = useState<Record<string, BalanceCheck[]>>({});
  const [statementPts, setStatementPts] = useState<Record<string, BarPoint[]>>({});
  const [loans, setLoans] = useState<Debt[]>([]);
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
  const occurrences = buildOccurrences(allBills, allPayments, monthStart, addDays(today, 14));
  const ff = cashAccounts.find((a) => a.name === "Fifth Third Checking");
  const chase = cashAccounts.find((a) => a.name === "Chase");
  const ffForecast = ff ? computeAccountForecast(ff, latestBalances[ff.name]?.balance ?? 0, occurrences, today, 0) : null;
  const chaseForecast = chase ? computeAccountForecast(chase, latestBalances[chase.name]?.balance ?? 0, occurrences, today, 0) : null;
  const transfer = ffForecast && chaseForecast ? computeSuggestedTransfer(ffForecast, chaseForecast) : null;

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
      detail: `${openInvoices.length} invoice${openInvoices.length === 1 ? "" : "s"}: ${invoiceByVendor.map(([v, a]) => `${v} $${formatMoney(a)}`).join(", ")}${coveredCount > 0 ? ` (${coveredCount} more covered by scheduled bills)` : ""}. Mark them paid, or link them to a scheduled bill, on the Statements page.`,
      amount: invoiceTotal,
    }] : []),
    ...(cardMinTotal > 0 ? [{ label: "Card minimums not scheduled as bills", detail: unscheduledCardMins.map((c) => `${c.name} $${formatMoney(c.amount)}`).join(", "), amount: cardMinTotal }] : []),
  ];
  const owedTotal = owedItems.reduce((sum, i) => sum + i.amount, 0);
  const requiredCollections = ff && chase
    ? computeRequiredCollections(ff, chase, latestBalances[ff.name]?.balance ?? 0, latestBalances[chase.name]?.balance ?? 0, fullMonthOccurrences, productionNum, owedTotal)
    : null;

  const cardRecs = cards.map((card) => {
    const linkedAccount = cashAccounts.find((a) => a.id === card.linkedCashAccountId);
    let accountForecast = null;
    if (linkedAccount) {
      const accountBills = allBills.filter((b) => b.cashAccountId === linkedAccount.id);
      const accountOccurrences = buildOccurrences(accountBills, allPayments, monthStart, addDays(today, WINDOW_DAYS));
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
  interface Warn { kind: WarnKind; text: string; lead?: boolean }
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
    if (transfer && transfer.amount > 0 && transfer.fromAccountName === a.name) warns.push({ kind: "suggest", text: `transfer $${formatMoney(transfer.amount)} to ${transfer.toAccountName}. ${transfer.reason}` });
    if (transfer && transfer.amount > 0 && transfer.toAccountName === a.name) warns.push({ kind: "suggest", text: `a $${formatMoney(transfer.amount)} transfer from ${transfer.fromAccountName} is suggested to cover this.`, lead: false });
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
    if (!bill) { setQ(t, { msg: "Link a scheduled payment first (loans: Edit on the Numbers tab)." }); return; }
    // The payment settles the earliest unpaid occurrence of this bill, so it leaves Need to collect.
    const occ = buildOccurrences([bill], allPayments, addDays(today, -35), monthEnd).filter((o) => !o.isPaid && o.direction === "outflow")[0];
    if (!occ) { setQ(t, { msg: "Nothing unpaid on this payment schedule right now." }); return; }
    await saveBillPayment(bill.id, occ.dueDate, n);
    setQ(t, { payAmt: "", msg: `Payment of $${formatMoney(n)} recorded against ${new Date(occ.dueDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}.` });
    refreshAll();
  }

  const renderTile = (t: (typeof tiles)[number]) => (
        <div key={t.key} className="rounded-2xl bg-white shadow px-5 py-4 space-y-3">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <div className="flex flex-col gap-1.5 min-w-0" style={{ flex: "0 0 270px" }}>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-base text-slate-800">{t.name}</h3>
                <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 rounded-full px-2 py-0.5">{t.tag}</span>
                <button onClick={() => setQ(t, { open: !getQ(t).open })} className="text-xs font-semibold text-orange-500 hover:underline">{getQ(t).open ? "Close" : "Update"}</button>
              </div>
              <div>
                <p className="text-3xl font-bold leading-tight" style={{ color: "#4A4238" }}>{t.balance != null ? formatUSD(t.balance) : "—"}</p>
                <p className="text-xs text-slate-500">current balance</p>
              </div>
              <UpdatedStamp when={t.checkedAt} warnings={t.warns.filter((w) => w.kind === "update").map((w) => w.text)} />
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
                <span key={i} className="text-xs font-medium rounded-lg px-2.5 py-1" style={{ color: WARN_STYLE[w.kind].fg, background: WARN_STYLE[w.kind].bg }}>⚠️ {w.text.charAt(0).toUpperCase() + w.text.slice(1)}</span>
              ))}
            </div>
          )}
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
                    <a href="/statements" className="text-xs font-semibold text-orange-500 hover:underline">File a statement →</a>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
  );

  return (
    <div className="space-y-3">
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
        {leadWarns.length === 0 ? (
          <p className="text-sm text-emerald-700 py-1">✓ Nothing needs attention right now.</p>
        ) : leadWarns.map((w, i) => (
          <div key={i} className="flex items-center gap-2.5 py-1.5 border-t border-slate-100 text-sm">
            <span className="shrink-0 text-center text-[11px] font-semibold rounded-full py-0.5" style={{ width: 78, color: WARN_STYLE[w.warn.kind].fg, background: WARN_STYLE[w.warn.kind].bg }}>{WARN_STYLE[w.warn.kind].tag}</span>
            <span className="min-w-0"><strong className="text-slate-800">{w.account}</strong> — {w.warn.text}</span>
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

      {/* 4. One horizontal card per bank account and credit card */}
      {/* 4. Cards grouped: Accounts, then Debt (credit cards, then loans by kind), then Practice */}
      {sectionHeader("accounts", "Accounts", `${bankTiles.length} · $${formatMoney(sumNamed(cashAccounts.map((a) => a.name)))} combined`)}
      {!collapsed.accounts && bankTiles.map(renderTile)}

      {sectionHeader("debt", "Debt", `${cardTiles.length + loanTiles.length} · $${formatMoney(cardsOwed + loansOwed)} owed`)}
      {!collapsed.debt && (
        <>
          {cardTiles.length > 0 && subHeader("Credit cards", `$${formatMoney(cardsOwed)} current balance`)}
          {cardTiles.map(renderTile)}
          {loanGroups.map((g) => (
            <Fragment key={g.cat}>
              {subHeader(CATEGORY_LABEL[g.cat], `$${formatMoney(g.owed)} owed · $${formatMoney(g.payment)}/mo`)}
              {g.tiles.map(renderTile)}
            </Fragment>
          ))}
        </>
      )}

      {sectionHeader("practice", "Practice", "Open Dental and accounts receivable")}

      {!collapsed.practice && (
      <div className="flex flex-wrap gap-3">
        {([
          {
            title: "Open Dental", warns: [] as Warn[], when: latestReview?.reviewDate,
            series: [
              { label: "Net production", mode: "month", points: odSeries.production, caption: "Monthly · current month is the projection" },
              { label: "Income", mode: "month", points: odSeries.income, caption: "Last income entry of each month (current month is month-to-date)" },
              { label: "Patient", mode: "month", points: odSeries.patient, caption: "Last patient income entry of each month" },
              { label: "Insurance", mode: "month", points: odSeries.insurance, caption: "Last insurance income entry of each month" },
            ] as BarSeries[],
          },
          {
            title: "Accounts receivable", warns: [] as Warn[], when: latestArAging?.entryDate,
            series: [{ label: "Total A/R", mode: "week", points: arPoints, caption: "Total A/R · last entry each week" }] as BarSeries[],
          },
        ]).map((c) => (
          <div key={c.title} className="rounded-2xl bg-white shadow px-5 py-4 space-y-2" style={{ flex: "1 1 520px", minWidth: 0 }}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="font-bold text-sm text-slate-800">{c.title}</h3>
              <UpdatedStamp when={c.when} warnings={c.warns.map((w) => w.text)} />
            </div>
            <BarChart series={c.series} />
            {c.warns.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {c.warns.map((w, i) => (
                  <span key={i} className="text-xs font-medium rounded-lg px-2.5 py-1" style={{ color: WARN_STYLE[w.kind].fg, background: WARN_STYLE[w.kind].bg }}>⚠️ {w.text.charAt(0).toUpperCase() + w.text.slice(1)}</span>
                ))}
              </div>
            )}
          </div>
        ))}
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
          <div className="max-w-5xl">
            <div className="mb-4 flex flex-wrap gap-2">
              <button onClick={() => setActiveTab("overview")} className="px-4 py-2 text-sm font-semibold transition rounded-lg border-2"
                style={activeTab === "overview" ? { backgroundColor: "#e8622a", color: "white", borderColor: "#e8622a" } : { backgroundColor: "#d1fae5", color: "#065f46", borderColor: "#065f46" }}>Overview &amp; Trends</button>
              <button onClick={() => setActiveTab("entry")} className="px-4 py-2 text-sm font-semibold transition rounded-lg border-2"
                style={activeTab === "entry" ? { backgroundColor: "#e8622a", color: "white", borderColor: "#e8622a" } : { backgroundColor: "#d1fae5", color: "#065f46", borderColor: "#065f46" }}>
                Numbers
              </button>
              {cashAccounts.map((a) => (
                <button key={a.id} onClick={() => setActiveTab(a.id)} className="px-4 py-2 text-sm font-semibold transition rounded-lg border-2"
                  style={activeTab === a.id ? { backgroundColor: "#e8622a", color: "white", borderColor: "#e8622a" } : { backgroundColor: "#d1fae5", color: "#065f46", borderColor: "#065f46" }}>{a.name}</button>
              ))}
              

              
            </div>

            <UpdateNumbersFlow open={flowOpen} onClose={() => setFlowOpen(false)} onSaved={() => refresh(true)}
              accounts={cashAccounts} cards={creditCards} loans={staleData.loans} latestBalances={latestBalances}
              statements={staleData.statements} review={latestReviewForTabs} ar={staleData.ar} dueNames={staleItems.map((i) => i.name)} />

            {cashAccounts.map((a) => activeTab === a.id && (
              <AccountPanel key={a.id} account={a} allBills={bills} allPayments={payments} latestBalances={latestBalances} cards={creditCards} refreshAll={refresh} />
            ))}
            {activeTab === "overview" && (
              <OverviewPanel refreshAll={() => refresh(true)} staleItems={staleItems} cashAccounts={cashAccounts} cards={creditCards} charges={cardCharges} allBills={bills} allPayments={payments} latestBalances={latestBalances} onViewArDetails={() => setActiveTab("entry")} />
            )}
            {activeTab === "entry" && (
              <WeeklyUpdatePanel cashAccounts={cashAccounts} cards={creditCards} latestBalances={latestBalances} refreshAll={() => refresh(true)}
                charges={cardCharges} allBills={bills} allPayments={payments} loans={staleData.loans}
                debtMonthlyCollections={debtMonthlyCollections} />
            )}
          </div>
        )}
      </div>
    </main>
  );
}
