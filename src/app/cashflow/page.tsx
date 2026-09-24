"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { formatMoney } from "@/lib/format";
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
  ArAgingEntry, loadLatestArAging, loadArAgingHistory, saveArAgingEntry, deleteArAgingEntry, computeArHealth, computeAvgMonthlyProduction,
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

function CreditCardsPanel({ cards, charges, cashAccounts, latestBalances, allBills, allPayments, refreshAll }: {
  cards: CreditCard[]; charges: CardCharge[]; cashAccounts: CashAccount[]; latestBalances: Record<string, BalanceCheck>;
  allBills: RecurringBill[]; allPayments: BillPayment[]; refreshAll: () => void;
}) {
  const [balanceInputs, setBalanceInputs] = useState<Record<string, string>>({});
  const [stmtInputs, setStmtInputs] = useState<Record<string, string>>({});
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [chargeForm, setChargeForm] = useState({ vendor: "", typicalAmount: "", approxDayOfMonth: "1", notes: "" });

  const today = todayStr();
  const monthStart = today.slice(0, 8) + "01";
  const ff = cashAccounts.find((a) => a.name === "Fifth Third Checking");
  const chase = cashAccounts.find((a) => a.name === "Chase");
  const ffOccForTransfer = ff ? buildOccurrences(allBills.filter((b) => b.cashAccountId === ff.id), allPayments, monthStart, addDays(today, WINDOW_DAYS)) : [];
  const chaseOccForTransfer = chase ? buildOccurrences(allBills.filter((b) => b.cashAccountId === chase.id), allPayments, monthStart, addDays(today, WINDOW_DAYS)) : [];
  const ffForecastForTransfer = ff ? computeAccountForecast(ff, latestBalances[ff.name]?.balance ?? 0, ffOccForTransfer, today, 0) : null;
  const chaseForecastForTransfer = chase ? computeAccountForecast(chase, latestBalances[chase.name]?.balance ?? 0, chaseOccForTransfer, today, 0) : null;
  const transfer = ffForecastForTransfer && chaseForecastForTransfer ? computeSuggestedTransfer(ffForecastForTransfer, chaseForecastForTransfer) : null;

  async function handleUpdateBalance(card: CreditCard) {
    const raw = balanceInputs[card.id];
    const amount = Number(raw);
    if (!raw || isNaN(amount)) return;
    await addBalanceCheck(card.name, amount);
    setBalanceInputs((f) => ({ ...f, [card.id]: "" }));
    refreshAll();
  }

  async function handleUpdateStatement(card: CreditCard) {
    const raw = stmtInputs[card.id];
    const amount = Number(raw);
    if (!raw || isNaN(amount)) return;
    const result = await updateStatementBalance(card.id, amount);
    if (!result.ok) { alert(`Failed to save statement balance for ${card.name}: ${result.error ?? "unknown error"}`); return; }
    setStmtInputs((f) => ({ ...f, [card.id]: "" }));
    refreshAll();
  }

  async function handleAddCharge(cardId: string) {
    const amount = Number(chargeForm.typicalAmount);
    const day = Number(chargeForm.approxDayOfMonth);
    if (!chargeForm.vendor.trim() || !amount || !day) return;
    await addCardCharge({ creditCardId: cardId, vendor: chargeForm.vendor.trim(), typicalAmount: amount, approxDayOfMonth: day, notes: chargeForm.notes.trim() || undefined, active: true });
    setChargeForm({ vendor: "", typicalAmount: "", approxDayOfMonth: "1", notes: "" });
    refreshAll();
  }

  async function handleRemoveCharge(id: string) {
    await deleteCardCharge(id);
    refreshAll();
  }

  const cardsWithRecs = cards.map((card) => {
    const balance = latestBalances[card.name]?.balance ?? 0;
    const linkedAccount = cashAccounts.find((a) => a.id === card.linkedCashAccountId);
    let accountForecast = null;
    if (linkedAccount) {
      const accountBills = allBills.filter((b) => b.cashAccountId === linkedAccount.id);
      const occurrences = buildOccurrences(accountBills, allPayments, today.slice(0, 8) + "01", addDays(today, WINDOW_DAYS));
      accountForecast = computeAccountForecast(linkedAccount, latestBalances[linkedAccount.name]?.balance ?? 0, occurrences, today, 0);
      if (accountForecast && transfer && transfer.fromAccountName === linkedAccount.name) {
        accountForecast = { ...accountForecast, excessOrShortfall: Math.max(0, accountForecast.excessOrShortfall - transfer.amount) };
      }
    }
    const rec = computeCardRecommendation(card, balance, charges, today, accountForecast);
    const hasAlert = rec.overLimitRisk || rec.urgentMinimumDue || rec.suggestedExtraPayment > 0;
    return { card, balance, rec, hasAlert };
  }).sort((a, b) => (a.hasAlert === b.hasAlert ? 0 : a.hasAlert ? -1 : 1));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white shadow p-4">
        <h2 className="font-bold text-slate-700 text-sm mb-3">Current Balances</h2>
        <div className="flex flex-wrap gap-2">
          {cardsWithRecs.map(({ card, balance, hasAlert }) => (
            <div key={card.id} className="rounded-lg px-3 py-2 border-2" style={hasAlert ? { backgroundColor: "#fee2e2", borderColor: "#991b1b" } : { backgroundColor: "#f8fafc", borderColor: "#cbd5e1" }}>
              <p className="text-xs font-semibold" style={{ color: hasAlert ? "#991b1b" : "#475569" }}>{hasAlert ? "⚠️ " : ""}{card.name}</p>
              <p className="text-base font-bold" style={{ color: hasAlert ? "#991b1b" : "#1e293b" }}>${formatMoney(balance)}</p>
            </div>
          ))}
        </div>
      </div>

      {cardsWithRecs.map(({ card, balance, rec }) => {
        const linkedAccount = cashAccounts.find((a) => a.id === card.linkedCashAccountId);
        const cardCharges = charges.filter((c) => c.creditCardId === card.id && c.active);

        return (
          <div key={card.id} className="rounded-2xl bg-white shadow p-5">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
              <div>
                <h3 className="font-bold text-slate-700">{card.name}</h3>
                <p className="text-xs text-slate-400">Pays from {linkedAccount?.name ?? "—"} · Closes ~day {card.approxClosingDay} ({rec.daysUntilClosing}d) · Due day {card.dueDay} ({rec.daysUntilDue}d)</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-slate-700">${formatMoney(balance)}</p>
                <p className="text-xs text-slate-500">${formatMoney(rec.availableCredit)} available of ${formatMoney(card.creditLimit)}</p>
              </div>
            </div>

            {rec.overLimitRisk && (
              <div className="rounded-lg p-3 mb-3 bg-red-50 border border-red-200">
                <p className="text-sm font-semibold text-red-700">🚨 Projected to approach the credit limit within 14 days (est. ${formatMoney(rec.projectedBalance)} of ${formatMoney(card.creditLimit)}). Pay down now.</p>
              </div>
            )}
            {rec.urgentMinimumDue && (
              <div className="rounded-lg p-3 mb-3 bg-amber-50 border border-amber-200">
                <p className="text-sm font-semibold text-amber-800">⏰ Payment due in {rec.daysUntilDue} day{rec.daysUntilDue === 1 ? "" : "s"} — minimum ${formatMoney(card.minimumPayment)}, scheduled AutoPay ${formatMoney(card.autopayAmount)}.</p>
              </div>
            )}
            {rec.suggestedExtraPayment > 0 && !rec.overLimitRisk && (
              <div className="rounded-lg p-3 mb-3 bg-blue-50 border border-blue-200">
                <p className="text-sm text-blue-800">💰 {linkedAccount?.name} has spare cash flow — consider an extra ${formatMoney(rec.suggestedExtraPayment)} paydown toward the ${formatMoney(rec.statementBalance)} statement balance to avoid interest.</p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 mb-3">
              <div>
                <label className="block text-sm text-slate-800 font-semibold mb-1">
                  Update Current Balance
                  <span className="block text-xs font-normal text-slate-400 mt-0.5">
                    {latestBalances[card.name] ? `Last updated ${new Date(latestBalances[card.name].checkedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Never entered"}
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <input type="number" onFocus={(e) => e.target.select()} value={balanceInputs[card.id] ?? String(balance)} onChange={(e) => setBalanceInputs((f) => ({ ...f, [card.id]: e.target.value }))}
                    placeholder="New balance" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                  <button onClick={() => handleUpdateBalance(card)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white whitespace-nowrap hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>Update</button>
                </div>
                <BalanceHistoryList accountName={card.name} refreshAll={refreshAll} />
              </div>
              <div>
                <label className="block text-sm mb-1">
                  <span className={rec.statementStale ? "text-amber-600 font-semibold" : "text-slate-800 font-semibold"}>
                    Statement Balance {rec.statementStale ? "⚠️ Update due" : `— $${formatMoney(card.statementBalance)}`}
                  </span>
                  <span className="block text-xs font-normal text-slate-400 mt-0.5">
                    {card.statementBalanceUpdatedAt ? `Last updated ${new Date(card.statementBalanceUpdatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Never entered"}
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <input type="number" onFocus={(e) => e.target.select()} value={stmtInputs[card.id] ?? String(card.statementBalance)} onChange={(e) => setStmtInputs((f) => ({ ...f, [card.id]: e.target.value }))}
                    placeholder="From latest statement" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                  <button onClick={() => handleUpdateStatement(card)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white whitespace-nowrap hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>Update</button>
                </div>
              </div>
            </div>

            <button onClick={() => setExpandedCard(expandedCard === card.id ? null : card.id)} className="text-xs text-orange-500 hover:underline">
              {expandedCard === card.id ? "Hide" : "Show"} recurring charges on this card ({cardCharges.length})
            </button>

            {expandedCard === card.id && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="space-y-1 mb-3">
                  {cardCharges.map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-1.5">
                      <span className="text-slate-600">{c.vendor} — ~day {c.approxDayOfMonth}{c.notes ? ` · ${c.notes}` : ""}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-slate-700">${formatMoney(c.typicalAmount)}</span>
                        <button onClick={() => handleRemoveCharge(c.id)} className="text-red-400 hover:underline">✕</button>
                      </span>
                    </div>
                  ))}
                  {cardCharges.length === 0 && <p className="text-xs text-slate-400">No recurring charges logged for this card yet.</p>}
                </div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <input type="text" value={chargeForm.vendor} onChange={(e) => setChargeForm((f) => ({ ...f, vendor: e.target.value }))} placeholder="Vendor" className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none" />
                  <input type="number" onFocus={(e) => e.target.select()} value={chargeForm.typicalAmount} onChange={(e) => setChargeForm((f) => ({ ...f, typicalAmount: e.target.value }))} placeholder="Amount" className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none" />
                  <input type="number" onFocus={(e) => e.target.select()} value={chargeForm.approxDayOfMonth} onChange={(e) => setChargeForm((f) => ({ ...f, approxDayOfMonth: e.target.value }))} placeholder="Day of month" className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none" />
                  <button onClick={() => handleAddCharge(card.id)} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>Add Charge</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Weekly Review Panel ----------------

function OverviewPanel({ cashAccounts, cards, charges, allBills, allPayments, latestBalances, onViewArDetails }: {
  cashAccounts: CashAccount[]; cards: CreditCard[]; charges: CardCharge[]; allBills: RecurringBill[]; allPayments: BillPayment[];
  latestBalances: Record<string, BalanceCheck>; onViewArDetails: () => void;
}) {
  const [latestReview, setLatestReview] = useState<WeeklyCashReview | null>(null);
  const [history, setHistory] = useState<WeeklyCashReview[]>([]);
  const [latestArAging, setLatestArAging] = useState<ArAgingEntry | null>(null);
  const [avgMonthlyProduction, setAvgMonthlyProduction] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([loadLatestWeeklyReview(), loadWeeklyReviewHistory(8), loadLatestArAging(), loadDentalMonthlyHistory()]).then(([latest, hist, ar, dentalHist]) => {
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

  const productionTarget = 165000;
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
  const fullMonthOccurrences = buildOccurrences(allBills, allPayments, monthStart, monthEnd);
  const requiredCollections = ff && chase
    ? computeRequiredCollections(ff, chase, latestBalances[ff.name]?.balance ?? 0, latestBalances[chase.name]?.balance ?? 0, fullMonthOccurrences, productionNum)
    : null;

  const STALE_DAYS = 7;
  const reviewDaysStale = latestReview ? daysSinceDateStr(latestReview.reviewDate) : Infinity;
  const incomeStale = reviewDaysStale >= STALE_DAYS;

  // Statement balances are excluded here — they only change when a monthly
  // statement arrives, so measuring them against a 7-day rule reported the
  // numbers as out of date almost permanently. They're checked separately
  // against a full statement cycle below.
  const STATEMENT_STALE_DAYS = 40;
  const balanceTimestamps = [
    ...cashAccounts.map((a) => latestBalances[a.name]?.checkedAt),
    ...cards.map((c) => latestBalances[c.name]?.checkedAt),
  ].filter((t): t is string => !!t);
  const oldestBalanceTimestamp = balanceTimestamps.length > 0 ? balanceTimestamps.reduce((oldest, t) => (t < oldest ? t : oldest)) : null;
  const balanceDaysStale = oldestBalanceTimestamp ? (Date.now() - new Date(oldestBalanceTimestamp).getTime()) / 86400000 : Infinity;
  const anyBalanceMissing = cashAccounts.some((a) => !latestBalances[a.name]) || cards.some((c) => !latestBalances[c.name]);
  const balancesStale = balanceDaysStale >= STALE_DAYS || anyBalanceMissing;
  const statementsStale = cards.some((c) =>
    c.statementBalanceUpdatedAt != null &&
    (Date.now() - new Date(c.statementBalanceUpdatedAt).getTime()) / 86400000 >= STATEMENT_STALE_DAYS
  );

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

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        {ffForecast && (
          <div className="rounded-xl p-4 shadow" style={{ background: `linear-gradient(135deg, ${safeColor(ffForecast.excessOrShortfall)}22, ${safeColor(ffForecast.excessOrShortfall)}44)` }}>
            <p className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold leading-tight">{ffForecast.accountName}</p>
            <p className="text-lg font-bold mt-1" style={{ color: safeColor(ffForecast.excessOrShortfall) }}>${formatMoney(ffForecast.excessOrShortfall)}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">excess/(shortfall)</p>
          </div>
        )}
        {chaseForecast && (
          <div className="rounded-xl p-4 shadow" style={{ background: `linear-gradient(135deg, ${safeColor(chaseForecast.excessOrShortfall)}22, ${safeColor(chaseForecast.excessOrShortfall)}44)` }}>
            <p className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold leading-tight">{chaseForecast.accountName}</p>
            <p className="text-lg font-bold mt-1" style={{ color: safeColor(chaseForecast.excessOrShortfall) }}>${formatMoney(chaseForecast.excessOrShortfall)}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">excess/(shortfall)</p>
          </div>
        )}
        <div className="rounded-xl p-4 shadow bg-white">
          <p className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold leading-tight">Projected Production</p>
          <p className="text-lg font-bold mt-1" style={{ color: productionNum != null && productionNum >= productionTarget ? "#059669" : "#f59e0b" }}>{productionNum != null ? `$${formatMoney(productionNum)}` : "—"}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">vs ${formatMoney(productionTarget)}/mo</p>
        </div>
        <div className="rounded-xl p-4 shadow bg-white">
          <p className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold leading-tight">Current Income</p>
          <p className="text-lg font-bold mt-1" style={{ color: incomeNum != null && incomeNum >= proratedCollectionsTarget ? "#059669" : "#f59e0b" }}>{incomeNum != null ? `$${formatMoney(incomeNum)}` : "—"}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">vs ${formatMoney(proratedCollectionsTarget)} pace (day {now.getDate()}/{daysInMonth})</p>
        </div>
        <div className="rounded-xl p-4 shadow bg-white">
          <p className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold leading-tight">Insurance Income</p>
          <p className="text-lg font-bold mt-1 text-slate-700">{insuranceIncome != null ? `$${formatMoney(insuranceIncome)}` : "—"}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">calculated</p>
        </div>
      </div>

      {latestArAging && (() => {
        const health = computeArHealth({
          ar0to30: latestArAging.ar0to30, ar31to60: latestArAging.ar31to60,
          ar61to90: latestArAging.ar61to90, ar90plus: latestArAging.ar90plus,
          woEstimate: latestArAging.woEstimate,
        }, avgMonthlyProduction);
        const style = health.status === "good" ? { bg: "linear-gradient(135deg, #d1fae5, #a7f3d0)", color: "#065f46", label: "A/R Healthy", icon: "💚" }
          : health.status === "fair" ? { bg: "linear-gradient(135deg, #fff7ed, #ffedd5)", color: "#92400e", label: "A/R Needs Attention", icon: "⚠️" }
          : { bg: "linear-gradient(135deg, #fee2e2, #fecaca)", color: "#991b1b", label: "A/R Poor", icon: "🚨" };
        return (
          <div className="rounded-xl p-4 shadow flex items-center justify-between flex-wrap gap-3" style={{ background: style.bg }}>
            <div className="flex items-center gap-3">
              <span style={{ fontSize: 24 }}>{style.icon}</span>
              <div>
                <p className="font-bold" style={{ color: style.color }}>{style.label}</p>
                <p className="text-xs" style={{ color: style.color }}>
                  True A/R: ${formatMoney(health.totalAr)}
                  {health.daysInAr != null ? ` · Days in A/R: ${health.daysInAr.toFixed(0)}` : ""}
                </p>
              </div>
            </div>
            <button onClick={onViewArDetails} className="text-xs font-semibold underline" style={{ color: style.color }}>See details in Update Numbers →</button>
          </div>
        );
      })()}
      {incomeNum != null && productionNum != null && incomeNum < productionNum * monthProgress * 0.8 && (
        <p className="text-xs text-amber-600">Collections are lagging materially behind production — consider reviewing insurance AR aging before discretionary spending.</p>
      )}

      {requiredCollections && (
        <div className="rounded-xl p-4 shadow bg-white border border-slate-100">
          <p className="text-sm font-semibold text-slate-700">
            {productionNum != null
              ? <>Need to collect <strong style={{ color: requiredCollections.requiredCollectionRate != null && requiredCollections.requiredCollectionRate > 100 ? "#dc2626" : "#059669" }}>${formatMoney(requiredCollections.requiredCollections)}</strong> this month — {requiredCollections.requiredCollectionRate != null ? `${requiredCollections.requiredCollectionRate.toFixed(1)}%` : "—"} of your ${formatMoney(productionNum)} projected production — to cover all obligations plus both cushions.</>
              : <>Enter a Projected Total Production figure (Update Numbers tab) to see what collection rate is needed this month.</>}
          </p>
          <p className="text-xs text-slate-400 mt-1">${formatMoney(requiredCollections.totalObligations)} in obligations + ${formatMoney(requiredCollections.totalCushions)} cushions − ${formatMoney(requiredCollections.combinedCurrentBalance)} current combined balance{requiredCollections.knownInflows > 0 ? ` − $${formatMoney(requiredCollections.knownInflows)} known deposits` : ""} = ${formatMoney(requiredCollections.requiredCollections)} still needed.</p>
          {requiredCollections.requiredCollectionRate != null && requiredCollections.requiredCollectionRate > 100 && (
            <p className="text-xs text-red-600 mt-1 font-semibold">⚠️ This exceeds projected production — even collecting everything produced this month wouldn't be enough at current obligations and cushions.</p>
          )}
        </div>
      )}

      {(balancesStale || incomeStale) && (
        <div className="rounded-xl p-4 shadow bg-amber-50 border border-amber-200">
          <p className="text-sm font-semibold text-amber-800">⚠️ Numbers need updating:</p>
          <ul className="text-sm text-amber-700 mt-1 list-disc list-inside">
            {balancesStale && <li>Account/card balances — {oldestBalanceTimestamp ? `oldest entry ${new Date(oldestBalanceTimestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "never entered"}</li>}
            {statementsStale && <li>Credit card statement balances — last updated over a month ago</li>}
            {incomeStale && <li>Open Dental numbers — {latestReview ? `last entered ${new Date(latestReview.reviewDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "never entered"}</li>}
          </ul>
          <p className="text-xs text-amber-600 mt-1">Update these on the "Update Numbers" tab.</p>
        </div>
      )}

      {transfer && (
        <div className="rounded-xl p-4 shadow" style={{ background: transfer.amount > 0 ? "linear-gradient(135deg, #dbeafe, #bfdbfe)" : "#f8fafc" }}>
          {transfer.amount > 0 ? (
            <p className="text-sm text-blue-900"><strong>Transfer ${formatMoney(transfer.amount)}</strong> from {transfer.fromAccountName} to {transfer.toAccountName}. {transfer.reason}</p>
          ) : (
            <p className="text-sm text-slate-500">{transfer.reason}</p>
          )}
        </div>
      )}

      {cardAlerts.length > 0 && (
        <div className="space-y-2">
          {cardAlerts.map((rec) => (
            <div key={rec.cardId} className="rounded-xl p-4 shadow" style={{ background: rec.overLimitRisk ? "#fee2e2" : rec.urgentMinimumDue ? "#fef3c7" : "#dbeafe" }}>
              {rec.overLimitRisk && <p className="text-sm font-semibold text-red-700">🚨 {rec.cardName}: projected to approach the credit limit within 14 days (est. ${formatMoney(rec.projectedBalance)} of available credit used).</p>}
              {rec.urgentMinimumDue && <p className="text-sm font-semibold text-amber-800">⏰ {rec.cardName}: payment due in {rec.daysUntilDue} day{rec.daysUntilDue === 1 ? "" : "s"}.</p>}
              {!rec.overLimitRisk && !rec.urgentMinimumDue && rec.suggestedExtraPayment > 0 && <p className="text-sm text-blue-800">💰 {rec.cardName}: spare cash flow available — consider an extra ${formatMoney(rec.suggestedExtraPayment)} paydown toward the ${formatMoney(rec.statementBalance)} statement balance.</p>}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl p-5 shadow" style={{ background: "linear-gradient(135deg, #e0f2fe, #bae6fd)" }}>
        <h2 className="font-bold text-slate-700 mb-1">Check a Bill Before Paying</h2>
        <p className="text-xs text-slate-500 mb-4">Pick an already-scheduled transaction to see if it's still safe to pay as planned, or check a brand-new one-off payment that isn't in the system yet.</p>
        <div className="grid gap-3 sm:grid-cols-2 mb-3">
          <div>
            <label className="block text-sm text-slate-800 font-semibold mb-1">Account</label>
            <select value={checkAccountId} onChange={(e) => { setCheckAccountId(e.target.value); setCheckSelection(""); setCheckResult(null); }}
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none bg-white">
              <option value="">Select an account…</option>
              {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          {checkAccount && (
            <div>
              <label className="block text-sm text-slate-800 font-semibold mb-1">Which transaction?</label>
              <select value={checkSelection} onChange={(e) => { setCheckSelection(e.target.value); setCheckResult(null); setCheckOverrideAmount(""); }}
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none bg-white">
                <option value="">Select…</option>
                <option value="new">+ New one-time payment (not yet scheduled)</option>
                {upcomingForCheck.map((o) => (
                  <option key={`${o.billId}|${o.dueDate}`} value={`${o.billId}|${o.dueDate}`}>
                    {o.billName} — ${formatMoney(o.amount)} — {new Date(o.dueDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {checkAccount && checkSelection === "new" && (
          <div className="grid gap-3 sm:grid-cols-3 mb-3">
            <input type="text" value={checkNewName} onChange={(e) => setCheckNewName(e.target.value)} placeholder="What is this for?" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            <input type="number" onFocus={(e) => e.target.select()} value={checkNewAmount} onChange={(e) => setCheckNewAmount(e.target.value)} placeholder="Amount" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            <input type="date" value={checkNewDate} onChange={(e) => setCheckNewDate(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
        )}
        {checkAccount && checkSelection && checkSelection !== "new" && (
          <div className="mb-3">
            <label className="block text-sm text-slate-800 font-semibold mb-1">Override amount (optional — leave blank to check the scheduled estimate as-is)</label>
            <input type="number" onFocus={(e) => e.target.select()} value={checkOverrideAmount} onChange={(e) => setCheckOverrideAmount(e.target.value)} placeholder="$" className="w-48 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
        )}

        {checkAccount && checkSelection && (
          <button onClick={handleRunCheck} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#0369a1" }}>Check</button>
        )}

        {checkResult && (
          <div className="mt-3 rounded-lg p-3" style={{ background: checkResult.safe ? "#d1fae5" : "#fee2e2" }}>
            {checkResult.matchedExisting ? (
              <p className="text-sm" style={{ color: checkResult.safe ? "#065f46" : "#991b1b" }}>
                {checkResult.safe ? "✅ Safe" : "⚠️ Tight"} — this is already on the schedule. Projected balance on that date: <strong>${formatMoney(checkResult.projectedBalance)}</strong> ({checkResult.safe ? "stays above" : "would fall below"} your ${formatMoney(checkAccount!.cushionTarget)} cushion).
              </p>
            ) : checkResult.safe ? (
              <p className="text-sm text-emerald-800">✅ Safe to pay as planned. Projected balance afterward: <strong>${formatMoney(checkResult.projectedBalance)}</strong>.</p>
            ) : checkResult.suggestedDate ? (
              <p className="text-sm text-red-800">⚠️ Not safe on that date (would land at ${formatMoney(checkResult.projectedBalance)}). Wait until <strong>{new Date(checkResult.suggestedDate + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" })}</strong> instead — projected balance then: ${formatMoney(checkResult.suggestedBalance ?? 0)}.</p>
            ) : (
              <p className="text-sm text-red-800">⚠️ Not safe on that date, and no safer date found in the next 60 days. This may need to wait for more cash flow.</p>
            )}
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div className="rounded-2xl bg-white shadow p-5">
          <h3 className="font-bold text-slate-700 text-sm mb-2">Review History</h3>
          <div className="space-y-1">
            {history.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-1.5">
                <span className="text-slate-600">{new Date(r.reviewDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                <span className="text-xs text-slate-400">
                  {r.projectedTotalProduction != null ? `Prod: $${formatMoney(r.projectedTotalProduction)}` : ""}
                  {r.currentIncome != null ? ` · Income: $${formatMoney(r.currentIncome)}` : ""}
                  {r.currentPatientIncome != null && r.currentIncome != null ? ` · Insurance: $${formatMoney(r.currentIncome - r.currentPatientIncome)}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Update Numbers Panel (all manual entry, one place) ----------------

function EntryPanel({ cashAccounts, cards, latestBalances, refreshAll }: {
  cashAccounts: CashAccount[]; cards: CreditCard[]; latestBalances: Record<string, BalanceCheck>; refreshAll: () => void;
}) {
  const [latestReview, setLatestReview] = useState<WeeklyCashReview | null>(null);
  const [projectedProduction, setProjectedProduction] = useState("");
  const [currentIncome, setCurrentIncome] = useState("");
  const [currentPatientIncome, setCurrentPatientIncome] = useState("");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const [ar0to30, setAr0to30] = useState("");
  const [ar31to60, setAr31to60] = useState("");
  const [ar61to90, setAr61to90] = useState("");
  const [ar90plus, setAr90plus] = useState("");
  const [arWoEstimate, setArWoEstimate] = useState("");
  const [arInsuranceEstimate, setArInsuranceEstimate] = useState("");
  const [latestArAging, setLatestArAging] = useState<ArAgingEntry | null>(null);
  const [avgMonthlyProduction, setAvgMonthlyProduction] = useState<number | null>(null);
  const [arSaved, setArSaved] = useState(false);
  const [arError, setArError] = useState<string | null>(null);

  const [balanceInputs, setBalanceInputs] = useState<Record<string, string>>({});
  const [stmtInputs, setStmtInputs] = useState<Record<string, string>>({});
  const [bankStmtInputs, setBankStmtInputs] = useState<Record<string, string>>({});
  const [balancesSaved, setBalancesSaved] = useState(false);
  const [balancesError, setBalancesError] = useState<string | null>(null);

  useEffect(() => {
    loadLatestWeeklyReview().then((latest) => {
      setLatestReview(latest);
      if (latest) {
        setProjectedProduction(latest.projectedTotalProduction != null ? String(latest.projectedTotalProduction) : "");
        setCurrentIncome(latest.currentIncome != null ? String(latest.currentIncome) : "");
        setCurrentPatientIncome(latest.currentPatientIncome != null ? String(latest.currentPatientIncome) : "");
        setNotes(latest.notes);
      }
    });
    loadLatestArAging().then((latest) => {
      setLatestArAging(latest);
      if (latest) {
        setAr0to30(String(latest.ar0to30));
        setAr31to60(String(latest.ar31to60));
        setAr61to90(String(latest.ar61to90));
        setAr90plus(String(latest.ar90plus));
        setArWoEstimate(String(latest.woEstimate));
        setArInsuranceEstimate(String(latest.insuranceEstimate));
      }
    });
    loadDentalMonthlyHistory().then((history) => {
      setAvgMonthlyProduction(computeAvgMonthlyProduction(history));
    });
  }, []);

  const today = todayStr();
  const productionNum = projectedProduction ? Number(projectedProduction) : null;
  const incomeNum = currentIncome ? Number(currentIncome) : null;
  const patientIncomeNum = currentPatientIncome ? Number(currentPatientIncome) : null;
  const insuranceIncome = incomeNum != null && patientIncomeNum != null ? incomeNum - patientIncomeNum : null;
  const hasUnsavedIncomeChanges =
    (projectedProduction !== (latestReview?.projectedTotalProduction != null ? String(latestReview.projectedTotalProduction) : "")) ||
    (currentIncome !== (latestReview?.currentIncome != null ? String(latestReview.currentIncome) : "")) ||
    (currentPatientIncome !== (latestReview?.currentPatientIncome != null ? String(latestReview.currentPatientIncome) : ""));

  async function handleSave() {
    const result = await saveWeeklyReview({
      reviewDate: today, projectedTotalProduction: productionNum, currentIncome: incomeNum,
      currentPatientIncome: patientIncomeNum, notes,
    });
    if (!result.ok) { alert(`Failed to save: ${result.error ?? "unknown error"}`); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    const latest = await loadLatestWeeklyReview();
    setLatestReview(latest);
  }

  async function handleSaveAr() {
    const result = await saveArAgingEntry({
      entryDate: today,
      ar0to30: ar0to30 ? Number(ar0to30) : 0,
      ar31to60: ar31to60 ? Number(ar31to60) : 0,
      ar61to90: ar61to90 ? Number(ar61to90) : 0,
      ar90plus: ar90plus ? Number(ar90plus) : 0,
      woEstimate: arWoEstimate ? Number(arWoEstimate) : 0,
      insuranceEstimate: arInsuranceEstimate ? Number(arInsuranceEstimate) : 0,
    });
    if (!result.ok) { setArError(result.error ?? "Failed to save."); return; }
    setArError(null);
    setArSaved(true);
    setTimeout(() => setArSaved(false), 3000);
    const latest = await loadLatestArAging();
    setLatestArAging(latest);
  }

  async function handleSaveAllBalances() {
    const jobs: { label: string; promise: Promise<{ ok: boolean; error?: string }> }[] = [];
    for (const acct of cashAccounts) {
      const raw = balanceInputs[acct.id];
      if (raw && !isNaN(Number(raw))) jobs.push({ label: `${acct.name} balance`, promise: addBalanceCheck(acct.name, Number(raw)) });
      const rawStmt = bankStmtInputs[acct.id];
      if (rawStmt && !isNaN(Number(rawStmt))) jobs.push({ label: `${acct.name} statement balance`, promise: updateBankStatementBalance(acct.id, Number(rawStmt)) });
    }
    for (const card of cards) {
      const rawBal = balanceInputs[card.id];
      if (rawBal && !isNaN(Number(rawBal))) jobs.push({ label: `${card.name} balance`, promise: addBalanceCheck(card.name, Number(rawBal)) });
      const rawStmt = stmtInputs[card.id];
      if (rawStmt && !isNaN(Number(rawStmt))) jobs.push({ label: `${card.name} statement balance`, promise: updateStatementBalance(card.id, Number(rawStmt)) });
    }
    const results = await Promise.all(jobs.map((j) => j.promise));
    const failures = jobs
      .map((j, i) => ({ label: j.label, error: results[i].error, ok: results[i].ok }))
      .filter((r) => !r.ok)
      .map((r) => `${r.label} (${r.error ?? "failed"})`);
    setBalanceInputs({});
    setStmtInputs({});
    setBankStmtInputs({});
    if (failures.length > 0) {
      setBalancesError(`⚠️ Some saves failed: ${failures.join("; ")}`);
      setBalancesSaved(false);
    } else {
      setBalancesError(null);
      setBalancesSaved(true);
      setTimeout(() => setBalancesSaved(false), 3000);
    }
    refreshAll();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white shadow p-5">
        <h2 className="font-bold text-slate-700 mb-1">Account & Card Balances</h2>
        <p className="text-sm text-slate-500 mb-4">Update everything here — the same numbers shown on each account/card's own tab, so updating here updates everywhere.</p>
        <div className="grid gap-3 sm:grid-cols-2 mb-3">
          {cashAccounts.map((acct) => (
            <div key={acct.id} className="rounded-lg bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-700 mb-2">{acct.name}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="block text-sm text-slate-800 font-semibold mb-1">
                    Balance <span className="text-slate-400 font-normal">— ${formatMoney(latestBalances[acct.name]?.balance ?? 0)}</span>
                    <span className="block text-xs font-normal text-slate-400 mt-0.5">{latestBalances[acct.name] ? `Last updated ${new Date(latestBalances[acct.name].checkedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Never entered"}</span>
                  </label>
                  <input type="number" onFocus={(e) => e.target.select()} value={balanceInputs[acct.id] ?? String(latestBalances[acct.name]?.balance ?? 0)} onChange={(e) => setBalanceInputs((f) => ({ ...f, [acct.id]: e.target.value }))}
                    placeholder="New balance" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm text-slate-800 font-semibold mb-1">
                    Statement Balance <span className="text-slate-400 font-normal">— ${formatMoney(acct.statementBalance)}</span>
                    <span className="block text-xs font-normal text-slate-400 mt-0.5">{acct.statementBalanceUpdatedAt ? `Last updated ${new Date(acct.statementBalanceUpdatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Never entered"}</span>
                  </label>
                  <input type="number" onFocus={(e) => e.target.select()} value={bankStmtInputs[acct.id] ?? String(acct.statementBalance)} onChange={(e) => setBankStmtInputs((f) => ({ ...f, [acct.id]: e.target.value }))}
                    placeholder="From statement" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map((card) => (
            <div key={card.id} className="rounded-lg bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-700 mb-2">{card.name}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="block text-sm text-slate-800 font-semibold mb-1">
                    Current Balance <span className="text-slate-400 font-normal">— ${formatMoney(latestBalances[card.name]?.balance ?? 0)}</span>
                    <span className="block text-xs font-normal text-slate-400 mt-0.5">{latestBalances[card.name] ? `Last updated ${new Date(latestBalances[card.name].checkedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Never entered"}</span>
                  </label>
                  <input type="number" onFocus={(e) => e.target.select()} value={balanceInputs[card.id] ?? String(latestBalances[card.name]?.balance ?? 0)} onChange={(e) => setBalanceInputs((f) => ({ ...f, [card.id]: e.target.value }))}
                    placeholder="New balance" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm text-slate-800 font-semibold mb-1">
                    Statement Balance <span className="text-slate-400 font-normal">— ${formatMoney(card.statementBalance)}</span>
                    <span className="block text-xs font-normal text-slate-400 mt-0.5">{card.statementBalanceUpdatedAt ? `Last updated ${new Date(card.statementBalanceUpdatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Never entered"}</span>
                  </label>
                  <input type="number" onFocus={(e) => e.target.select()} value={stmtInputs[card.id] ?? String(card.statementBalance)} onChange={(e) => setStmtInputs((f) => ({ ...f, [card.id]: e.target.value }))}
                    placeholder="From statement" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <button onClick={handleSaveAllBalances} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition mt-4" style={{ backgroundColor: "#e8622a" }}>
          Save All Balances
        </button>
        {balancesSaved && <span className="ml-3 text-xs text-emerald-600 font-semibold">✓ Saved</span>}
        {balancesError && <span className="text-sm text-red-600 font-semibold mt-2 block">{balancesError}</span>}
      </div>

      <div className="rounded-2xl bg-white shadow p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h2 className="font-bold text-slate-700">Open Dental Numbers</h2>
          <span className="text-xs text-slate-400">
            {latestReview ? `Last updated ${new Date(latestReview.reviewDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "Never entered"}
          </span>
        </div>
        <p className="text-sm text-slate-500 mb-4">Enter this week's figures — insurance income is calculated for you.</p>
        <div className="grid gap-3 sm:grid-cols-2 mb-4">
          <div>
            <label className="block text-sm text-slate-800 font-semibold mb-1">Projected Total Production (month-end estimate)</label>
            <input type="number" onFocus={(e) => e.target.select()} value={projectedProduction} onChange={(e) => setProjectedProduction(e.target.value)} placeholder="$" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm text-slate-800 font-semibold mb-1">Current Income (patient + insurance, so far this month)</label>
            <input type="number" onFocus={(e) => e.target.select()} value={currentIncome} onChange={(e) => setCurrentIncome(e.target.value)} placeholder="$" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm text-slate-800 font-semibold mb-1">Current Patient Income (so far this month)</label>
            <input type="number" onFocus={(e) => e.target.select()} value={currentPatientIncome} onChange={(e) => setCurrentPatientIncome(e.target.value)} placeholder="$" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm text-slate-800 font-semibold mb-1">Insurance Income <span className="text-slate-400 font-normal">(calculated)</span></label>
            <div className="w-full rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5 text-sm text-slate-600">
              {insuranceIncome != null ? `$${formatMoney(insuranceIncome)}` : "—"}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm text-slate-800 font-semibold mb-1">Notes (optional)</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
        </div>
        {hasUnsavedIncomeChanges && (
          <p className="text-sm text-red-600 font-semibold mb-2">⚠️ You've typed new numbers but haven't saved yet — click "Save This Week's Review" below to actually record this.</p>
        )}
        <button onClick={handleSave} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: hasUnsavedIncomeChanges ? "#dc2626" : "#e8622a" }}>
          {hasUnsavedIncomeChanges ? "Save This Week's Review — Unsaved Changes" : "Save This Week's Review"}
        </button>
        {saved && <span className="ml-3 text-xs text-emerald-600 font-semibold">✓ Saved</span>}
      </div>

      <div className="rounded-2xl bg-white shadow p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h2 className="font-bold text-slate-700">Accounts Receivable (A/R) Aging</h2>
          <span className="text-xs text-slate-400">
            {latestArAging ? `Last updated ${new Date(latestArAging.entryDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "Never entered"}
          </span>
        </div>
        <p className="text-sm text-slate-500 mb-4">Enter the total dollar amount in each aging bucket from your A/R report — update weekly to catch balances sliding toward 90+ days.</p>
        <div className="grid gap-3 sm:grid-cols-4 mb-3">
          <div>
            <label className="block text-sm text-slate-800 font-semibold mb-1">0–30 days</label>
            <input type="number" onFocus={(e) => e.target.select()} value={ar0to30} onChange={(e) => setAr0to30(e.target.value)} placeholder="$" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm text-slate-800 font-semibold mb-1">31–60 days</label>
            <input type="number" onFocus={(e) => e.target.select()} value={ar31to60} onChange={(e) => setAr31to60(e.target.value)} placeholder="$" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm text-slate-800 font-semibold mb-1">61–90 days</label>
            <input type="number" onFocus={(e) => e.target.select()} value={ar61to90} onChange={(e) => setAr61to90(e.target.value)} placeholder="$" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm text-slate-800 font-semibold mb-1">90+ days</label>
            <input type="number" onFocus={(e) => e.target.select()} value={ar90plus} onChange={(e) => setAr90plus(e.target.value)} placeholder="$" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
        </div>
        {(() => {
          const rawTotal = (ar0to30 ? Number(ar0to30) : 0) + (ar31to60 ? Number(ar31to60) : 0) + (ar61to90 ? Number(ar61to90) : 0) + (ar90plus ? Number(ar90plus) : 0);
          const woNum = arWoEstimate ? Number(arWoEstimate) : 0;
          const trueAr = Math.max(0, rawTotal - woNum);
          const insNum = arInsuranceEstimate ? Number(arInsuranceEstimate) : 0;
          const patientEstimate = trueAr - insNum;
          return (
            <div className="grid gap-3 sm:grid-cols-3 mb-4">
              <div>
                <label className="block text-sm text-slate-800 font-semibold mb-1">W/O Estimate <span className="text-slate-400 font-normal">(write-offs)</span></label>
                <input type="number" onFocus={(e) => e.target.select()} value={arWoEstimate} onChange={(e) => setArWoEstimate(e.target.value)} placeholder="$" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm text-slate-800 font-semibold mb-1">Insurance Estimate</label>
                <input type="number" onFocus={(e) => e.target.select()} value={arInsuranceEstimate} onChange={(e) => setArInsuranceEstimate(e.target.value)} placeholder="$" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm text-slate-800 font-semibold mb-1">Patient Estimate <span className="text-slate-400 font-normal">(auto: True A/R − Insurance)</span></label>
                <div className="w-full rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5 text-sm text-slate-600">
                  {rawTotal > 0 ? `$${formatMoney(patientEstimate)}` : "—"}
                </div>
              </div>
            </div>
          );
        })()}
        {(() => {
          const health = computeArHealth({
            ar0to30: ar0to30 ? Number(ar0to30) : 0, ar31to60: ar31to60 ? Number(ar31to60) : 0,
            ar61to90: ar61to90 ? Number(ar61to90) : 0, ar90plus: ar90plus ? Number(ar90plus) : 0,
            woEstimate: arWoEstimate ? Number(arWoEstimate) : 0,
          }, avgMonthlyProduction);
          if (health.totalAr <= 0 && !ar0to30 && !ar31to60 && !ar61to90 && !ar90plus) return null;
          const style = health.status === "good" ? { bg: "linear-gradient(135deg, #d1fae5, #a7f3d0)", color: "#065f46", ring: "#10b981", label: "✓ Healthy", icon: "💚" }
            : health.status === "fair" ? { bg: "linear-gradient(135deg, #fff7ed, #ffedd5)", color: "#92400e", ring: "#f59e0b", label: "Needs Attention", icon: "⚠️" }
            : { bg: "linear-gradient(135deg, #fee2e2, #fecaca)", color: "#991b1b", ring: "#dc2626", label: "Poor", icon: "🚨" };
          return (
            <div className="rounded-2xl p-5 mb-4" style={{ background: style.bg, boxShadow: `0 8px 24px ${style.ring}33`, border: `2px solid ${style.ring}` }}>
              <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
                <div className="flex items-center gap-3">
                  <span style={{ fontSize: 32 }}>{style.icon}</span>
                  <div>
                    <div className="text-2xl font-bold" style={{ color: style.color }}>{style.label}</div>
                    <div className="text-sm" style={{ color: style.color }}>True A/R: ${formatMoney(health.totalAr)}</div>
                  </div>
                </div>
              </div>
              <p className="text-sm font-medium" style={{ color: style.color }}>
                {health.pctCurrent.toFixed(0)}% current (0–30) · {health.pctOver60.toFixed(0)}% over 60 days · {health.pctOver90.toFixed(0)}% over 90 days
              </p>
              {health.arRatio != null && health.daysInAr != null ? (
                <p className="text-sm font-medium mt-1" style={{ color: style.color }}>
                  A/R Ratio: {health.arRatio.toFixed(2)} (target ~1.0) · Days in A/R: {health.daysInAr.toFixed(0)} (industry avg ~45)
                </p>
              ) : (
                <p className="text-xs mt-1 opacity-75" style={{ color: style.color }}>
                  A/R Ratio and Days in A/R need at least one month of Net Production logged on the Trends tab.
                </p>
              )}
              {health.reasons.length > 0 && (
                <ul className="text-sm mt-2 space-y-1 font-medium" style={{ color: style.color }}>
                  {health.reasons.map((r) => <li key={r}>• {r}</li>)}
                </ul>
              )}
            </div>
          );
        })()}
        <button onClick={handleSaveAr} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>
          Save A/R Aging
        </button>
        {arSaved && <span className="ml-3 text-xs text-emerald-600 font-semibold">✓ Saved</span>}
        {arError && <span className="ml-3 text-xs text-red-600 font-semibold">⚠️ {arError}</span>}
      </div>
    </div>
  );
}

// ---------------- Main Page ----------------

// ---------------- Trends Panel ----------------

// ---------------- Lightweight SVG line chart (no external dependency) ----------------

const CHART_COLORS = ["#e8622a", "#0369a1", "#059669", "#7c3aed", "#dc2626", "#0891b2"];

function TrendLineChart({ series, height = 220 }: { series: { label: string; color: string; points: { date: string; value: number }[] }[]; height?: number }) {
  const allDates = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.date)))).sort();
  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  if (allDates.length === 0 || allValues.length === 0) {
    return <p className="text-sm text-slate-400 py-8 text-center">Not enough data yet to chart.</p>;
  }
  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const range = rawMax - rawMin || Math.max(1, Math.abs(rawMax) * 0.1) || 1;
  const pad = range * 0.12;
  // Zoom into the actual data range so real differences are visible, rather
  // than always forcing the axis down to $0 (which flattens everything when
  // values are all large and close together). Zero is only forced onto the
  // axis if the data genuinely straddles it.
  const minY = rawMin >= 0 ? Math.max(0, rawMin - pad) : rawMin - pad;
  const maxY = rawMax <= 0 ? Math.min(0, rawMax + pad) : rawMax + pad;
  const axisIsZoomed = minY > 0 || maxY < 0;
  const width = 700;
  const padding = { top: 10, right: 10, bottom: 24, left: 64 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  function yScale(value: number) {
    return padding.top + chartHeight - ((value - minY) / (maxY - minY || 1)) * chartHeight;
  }
  function xScale(date: string) {
    const idx = allDates.indexOf(date);
    return padding.left + (allDates.length <= 1 ? chartWidth / 2 : (idx / (allDates.length - 1)) * chartWidth);
  }

  const xLabelStep = Math.max(1, Math.ceil(allDates.length / 6));

  return (
    <div>
      {axisIsZoomed && (
        <p className="text-[11px] text-slate-400 mb-1">Axis zoomed to ${formatMoney(minY)}–${formatMoney(maxY)} to make differences visible (doesn't start at $0).</p>
      )}
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const value = minY + frac * (maxY - minY);
          const y = yScale(value);
          return (
            <g key={frac}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fontSize={10} fill="#94a3b8">${Math.round(value / 1000)}k</text>
            </g>
          );
        })}
        {series.map((s) => {
          if (s.points.length === 0) return null;
          const pathD = s.points.map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.date)} ${yScale(p.value)}`).join(" ");
          return <path key={s.label} d={pathD} fill="none" stroke={s.color} strokeWidth={2} />;
        })}
        {series.map((s) => s.points.length === 1 ? s.points.map((p, i) => (
          <circle key={`${s.label}-${i}`} cx={xScale(p.date)} cy={yScale(p.value)} r={3} fill={s.color} />
        )) : null)}
        {allDates.filter((_, i) => i % xLabelStep === 0).map((date) => (
          <text key={date} x={xScale(date)} y={height - 5} textAnchor="middle" fontSize={9} fill="#94a3b8">
            {new Date(date.length === 7 ? date + "-02" : date.slice(0, 10) + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: date.length === 7 ? undefined : "numeric" })}
          </text>
        ))}
      </svg>
      <div className="flex flex-wrap gap-3 mt-2 justify-center">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: s.color }}></span>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------- Trends Panel ----------------

function TrendsPanel({ cashAccounts, cards, refreshAll }: { cashAccounts: CashAccount[]; cards: CreditCard[]; refreshAll: () => void }) {
  const [backfillEntityKey, setBackfillEntityKey] = useState(""); // "card:<id>" or "account:<name>"
  const [backfillMonth, setBackfillMonth] = useState(new Date().toISOString().slice(0, 7));
  const [backfillAmount, setBackfillAmount] = useState("");
  const [backfillConfirmation, setBackfillConfirmation] = useState<string | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [dentalBackfillMonth, setDentalBackfillMonth] = useState(new Date().toISOString().slice(0, 7));
  const [dentalBackfillProduction, setDentalBackfillProduction] = useState("");
  const [dentalBackfillConfirmation, setDentalBackfillConfirmation] = useState<string | null>(null);
  const [dentalBackfillError, setDentalBackfillError] = useState<string | null>(null);
  const [statementHistories, setStatementHistories] = useState<Record<string, CardStatementEntry[]>>({});
  const [bankStatementHistories, setBankStatementHistories] = useState<Record<string, BankStatementEntry[]>>({});
  const [dentalMonthlyHistory, setDentalMonthlyHistory] = useState<DentalMonthlyEntry[]>([]);
  const [arAgingHistory, setArAgingHistory] = useState<ArAgingEntry[]>([]);
  const [depthView, setDepthView] = useState<string | null>(null); // 'cardStatement' | 'dental' | 'ar' | null

  async function loadAll() {
    const [statementHists, dentalHistory, bankHists, arHistory] = await Promise.all([
      Promise.all(cards.map((c) => loadStatementHistoryForCard(c.id))),
      loadDentalMonthlyHistory(),
      Promise.all(cashAccounts.map((a) => loadStatementHistoryForAccount(a.id))),
      loadArAgingHistory(52),
    ]);
    const stmtMap: Record<string, CardStatementEntry[]> = {};
    cards.forEach((c, i) => { stmtMap[c.id] = statementHists[i]; });
    setStatementHistories(stmtMap);
    setDentalMonthlyHistory(dentalHistory);
    setArAgingHistory(arHistory);
    const bankMap: Record<string, BankStatementEntry[]> = {};
    cashAccounts.forEach((a, i) => { bankMap[a.id] = bankHists[i]; });
    setBankStatementHistories(bankMap);
  }

  useEffect(() => { loadAll(); }, [cashAccounts, cards]);

  async function handleBackfill() {
    const amount = Number(backfillAmount);
    if (!backfillEntityKey || !backfillMonth || !backfillAmount || isNaN(amount)) return;
    const [kind, ...rest] = backfillEntityKey.split(":");
    const monthLabel = new Date(backfillMonth + "-02").toLocaleDateString("en-US", { month: "long", year: "numeric" });

    if (kind === "card") {
      const cardId = rest.join(":");
      const card = cards.find((c) => c.id === cardId);
      const result = await backfillStatementMonth(cardId, backfillMonth, amount);
      if (!result.ok) {
        setBackfillError(result.error ?? "Save failed — the card_statement_entries table may not exist yet. Check that the SQL migration has been run.");
        setBackfillConfirmation(null);
        return;
      }
      setBackfillConfirmation(`✓ Saved ${card?.name ?? "card"} — ${monthLabel} — $${formatMoney(amount)}`);
    } else {
      const accountId = rest.join(":");
      const account = cashAccounts.find((a) => a.id === accountId);
      const result = await backfillBankStatementMonth(accountId, backfillMonth, amount);
      if (!result.ok) {
        setBackfillError(result.error ?? "Save failed — the bank_statement_entries table may not exist yet. Check that the SQL migration has been run.");
        setBackfillConfirmation(null);
        return;
      }
      setBackfillConfirmation(`✓ Saved ${account?.name ?? "account"} — ${monthLabel} — $${formatMoney(amount)}`);
    }
    setBackfillError(null);
    setBackfillAmount("");
    setTimeout(() => setBackfillConfirmation(null), 5000);
    await loadAll();
    refreshAll();
  }

  async function handleDeleteEntry(id: string) {
    if (!confirm("Delete this statement entry? This can't be undone.")) return;
    await deleteStatementEntry(id);
    await loadAll();
  }

  async function handleDeleteBankEntry(id: string) {
    if (!confirm("Delete this statement entry? This can't be undone.")) return;
    await deleteBankStatementEntry(id);
    await loadAll();
  }

  async function handleDentalBackfill() {
    const production = dentalBackfillProduction ? Number(dentalBackfillProduction) : null;
    if (!dentalBackfillMonth || production == null) return;
    const result = await backfillDentalMonth(dentalBackfillMonth, production);
    if (!result.ok) {
      setDentalBackfillError(result.error ?? "Save failed.");
      setDentalBackfillConfirmation(null);
      return;
    }
    setDentalBackfillError(null);
    const monthLabel = new Date(dentalBackfillMonth + "-02").toLocaleDateString("en-US", { month: "long", year: "numeric" });
    setDentalBackfillConfirmation(`✓ Saved Net Production for ${monthLabel}`);
    setDentalBackfillProduction("");
    setTimeout(() => setDentalBackfillConfirmation(null), 5000);
    await loadAll();
  }

  async function handleDeleteDentalEntry(id: string) {
    if (!confirm("Delete this Open Dental entry? This can't be undone.")) return;
    await deleteDentalMonthlyEntry(id);
    await loadAll();
  }

  async function handleDeleteArEntry(id: string) {
    if (!confirm("Delete this A/R aging entry? This can't be undone.")) return;
    await deleteArAgingEntry(id);
    await loadAll();
  }

  const cardStatementSeries = cards.map((c, i) => ({
    label: c.name, color: CHART_COLORS[i % CHART_COLORS.length],
    points: [...(statementHistories[c.id] ?? [])].reverse().map((e) => ({ date: e.month, value: e.balance })),
  }));

  const bankAccountSeries = cashAccounts.map((a, i) => ({
    label: a.name, color: CHART_COLORS[i % CHART_COLORS.length],
    points: [...(bankStatementHistories[a.id] ?? [])].reverse().map((e) => ({ date: e.month, value: e.balance })),
  }));

  const sortedDentalHistory = [...dentalMonthlyHistory].sort((a, b) => a.month.localeCompare(b.month));
  const dentalSeries = [
    { label: "Net Production", color: CHART_COLORS[0], points: sortedDentalHistory.filter((e) => e.netProduction != null).map((e) => ({ date: e.month, value: e.netProduction as number })) },
  ];

  const sortedArHistory = [...arAgingHistory].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  const arSeries = [
    { label: "Total A/R", color: CHART_COLORS[0], points: sortedArHistory.map((e) => ({ date: e.entryDate, value: e.ar0to30 + e.ar31to60 + e.ar61to90 + e.ar90plus })) },
    { label: "90+ days", color: "#dc2626", points: sortedArHistory.map((e) => ({ date: e.entryDate, value: e.ar90plus })) },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white shadow p-5">
        <h2 className="font-bold text-slate-700 mb-1">Add / Backfill a Monthly Balance</h2>
        <p className="text-sm text-slate-500 mb-4">Works for any bank account or credit card — enter a balance for any month, past or present, to build out the trend history below.</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-sm text-slate-800 font-semibold mb-1">Account / Card</label>
            <select value={backfillEntityKey} onChange={(e) => setBackfillEntityKey(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none bg-white">
              <option value="">Select…</option>
              <optgroup label="Bank Accounts">
                {cashAccounts.map((a) => <option key={a.id} value={`account:${a.id}`}>{a.name}</option>)}
              </optgroup>
              <optgroup label="Credit Cards">
                {cards.map((c) => <option key={c.id} value={`card:${c.id}`}>{c.name}</option>)}
              </optgroup>
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-800 font-semibold mb-1">Month</label>
            <input type="month" value={backfillMonth} onChange={(e) => setBackfillMonth(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm text-slate-800 font-semibold mb-1">Balance</label>
            <input type="number" onFocus={(e) => e.target.select()} value={backfillAmount} onChange={(e) => setBackfillAmount(e.target.value)} placeholder="$" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
          <div className="flex items-end">
            <button onClick={handleBackfill} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition w-full" style={{ backgroundColor: "#e8622a" }}>Save</button>
          </div>
        </div>
        {backfillConfirmation && <span className="text-sm text-emerald-600 font-semibold mt-2 block">{backfillConfirmation}</span>}
        {backfillError && <span className="text-sm text-red-600 font-semibold mt-2 block">⚠️ {backfillError}</span>}
      </div>

      <div className="rounded-2xl bg-white shadow p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-slate-700">Bank Accounts</h2>
          <button onClick={() => setDepthView(depthView === "bank" ? null : "bank")} className="text-xs text-orange-500 hover:underline">{depthView === "bank" ? "Standard view" : "In-depth view"}</button>
        </div>
        {depthView === "bank" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {cashAccounts.map((a, i) => (
              <div key={a.id}>
                <p className="text-sm font-semibold text-slate-700 mb-2">{a.name}</p>
                <TrendLineChart series={[bankAccountSeries[i]]} height={180} />
                <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                  {(bankStatementHistories[a.id] ?? []).map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-1">
                      <span className="text-slate-600">{new Date(entry.month + "-02").toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-slate-700">${formatMoney(entry.balance)}</span>
                        <button onClick={() => handleDeleteBankEntry(entry.id)} className="text-red-400 hover:underline">Delete</button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <TrendLineChart series={bankAccountSeries} />
        )}
      </div>

      <div className="rounded-2xl bg-white shadow p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-slate-700">Credit Cards — Statement Balance</h2>
          <button onClick={() => setDepthView(depthView === "cardStatement" ? null : "cardStatement")} className="text-xs text-orange-500 hover:underline">{depthView === "cardStatement" ? "Standard view" : "In-depth view"}</button>
        </div>
        {depthView === "cardStatement" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {cards.map((c, i) => (
              <div key={c.id}>
                <p className="text-sm font-semibold text-slate-700 mb-2">{c.name}</p>
                <TrendLineChart series={[cardStatementSeries[i]]} height={180} />
                <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                  {(statementHistories[c.id] ?? []).map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-1">
                      <span className="text-slate-600">{new Date(entry.month + "-02").toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-slate-700">${formatMoney(entry.balance)}</span>
                        <button onClick={() => handleDeleteEntry(entry.id)} className="text-red-400 hover:underline">Delete</button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <TrendLineChart series={cardStatementSeries} />
        )}
      </div>

      <div className="rounded-2xl bg-white shadow p-5">
        <h2 className="font-bold text-slate-700 mb-1">Add / Backfill Net Production</h2>
        <p className="text-sm text-slate-500 mb-4">Enter the official net production figure for any month, past or present. This is a separate historical record from the day-to-day running numbers on Update Numbers — one won't overwrite the other.</p>
        <div className="grid gap-3 sm:grid-cols-3 mb-3">
          <div>
            <label className="block text-sm text-slate-800 font-semibold mb-1">Month</label>
            <input type="month" value={dentalBackfillMonth} onChange={(e) => setDentalBackfillMonth(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm text-slate-800 font-semibold mb-1">Net Production</label>
            <input type="number" onFocus={(e) => e.target.select()} value={dentalBackfillProduction} onChange={(e) => setDentalBackfillProduction(e.target.value)} placeholder="$" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
          <div className="flex items-end">
            <button onClick={handleDentalBackfill} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition w-full" style={{ backgroundColor: "#e8622a" }}>Save</button>
          </div>
        </div>
        {dentalBackfillConfirmation && <span className="text-sm text-emerald-600 font-semibold mt-2 block">{dentalBackfillConfirmation}</span>}
        {dentalBackfillError && <span className="text-sm text-red-600 font-semibold mt-2 block">⚠️ {dentalBackfillError}</span>}
      </div>

      <div className="rounded-2xl bg-white shadow p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-slate-700">Open Dental — Net Production</h2>
          <button onClick={() => setDepthView(depthView === "dental" ? null : "dental")} className="text-xs text-orange-500 hover:underline">{depthView === "dental" ? "Standard view" : "In-depth view"}</button>
        </div>
        <TrendLineChart series={dentalSeries} />
        {depthView === "dental" && (
          <div className="mt-3 space-y-1 max-h-60 overflow-y-auto">
            {[...dentalMonthlyHistory].sort((a, b) => b.month.localeCompare(a.month)).map((e) => (
              <div key={e.id} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-1.5">
                <span className="text-slate-600">{new Date(e.month + "-02").toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
                <span className="flex items-center gap-2 text-xs text-slate-400">
                  <span>{e.netProduction != null ? `$${formatMoney(e.netProduction)}` : ""}</span>
                  <button onClick={() => handleDeleteDentalEntry(e.id)} className="text-red-400 hover:underline">Delete</button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-white shadow p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-slate-700">Accounts Receivable Trend</h2>
          <button onClick={() => setDepthView(depthView === "ar" ? null : "ar")} className="text-xs text-orange-500 hover:underline">{depthView === "ar" ? "Standard view" : "In-depth view"}</button>
        </div>
        <TrendLineChart series={arSeries} />
        {depthView === "ar" && (
          <div className="mt-3 space-y-1 max-h-60 overflow-y-auto">
            {[...arAgingHistory].sort((a, b) => b.entryDate.localeCompare(a.entryDate)).map((e) => {
              const total = e.ar0to30 + e.ar31to60 + e.ar61to90 + e.ar90plus;
              return (
                <div key={e.id} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-1.5">
                  <span className="text-slate-600">{new Date(e.entryDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  <span className="flex items-center gap-2 text-xs text-slate-400">
                    <span>Total: ${formatMoney(total)} · 90+: ${formatMoney(e.ar90plus)}</span>
                    <button onClick={() => handleDeleteArEntry(e.id)} className="text-red-400 hover:underline">Delete</button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CashFlowPage() {
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [cardCharges, setCardCharges] = useState<CardCharge[]>([]);
  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [payments, setPayments] = useState<BillPayment[]>([]);
  const [latestBalances, setLatestBalances] = useState<Record<string, BalanceCheck>>({});
  const [latestReviewForTabs, setLatestReviewForTabs] = useState<WeeklyCashReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("");

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
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
    if (!activeTab) setActiveTab("overview");
    setLoading(false);
  }

  // Current balances move constantly, so a week without an update means the
  // figures are genuinely out of date. Statement balances are a different
  // animal — they only change when a statement arrives, roughly monthly —
  // so holding them to the same 7-day rule flagged the tab red every week
  // with nothing new to enter. They get their own, much longer window.
  const STALE_DAYS_TABS = 7;
  const STATEMENT_STALE_DAYS = 40;
  const currentBalanceTimestamps = [
    ...cashAccounts.map((a) => latestBalances[a.name]?.checkedAt),
    ...creditCards.map((c) => latestBalances[c.name]?.checkedAt),
  ].filter((t): t is string => !!t);
  const oldestCurrentBalance = currentBalanceTimestamps.length > 0
    ? currentBalanceTimestamps.reduce((oldest, t) => (t < oldest ? t : oldest))
    : null;
  const currentBalancesStale = (oldestCurrentBalance ? (Date.now() - new Date(oldestCurrentBalance).getTime()) / 86400000 >= STALE_DAYS_TABS : true)
    || cashAccounts.some((a) => !latestBalances[a.name]) || creditCards.some((c) => !latestBalances[c.name]);
  // Only flags a statement that has been entered at least once and has since
  // aged past a full statement cycle. A card never given a statement balance
  // isn't nagged about, since that may simply not be tracked.
  const statementBalancesStale = creditCards.some((c) =>
    c.statementBalanceUpdatedAt != null &&
    (Date.now() - new Date(c.statementBalanceUpdatedAt).getTime()) / 86400000 >= STATEMENT_STALE_DAYS
  );
  const balancesStaleForTabs = currentBalancesStale || statementBalancesStale;
  const incomeStaleForTabs = latestReviewForTabs ? daysSinceDateStr(latestReviewForTabs.reviewDate) >= STALE_DAYS_TABS : true;
  const updateNumbersNeedsAttention = (balancesStaleForTabs || incomeStaleForTabs) && cashAccounts.length > 0;

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-24 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <header className="mb-4">
          <h1 className="text-2xl font-bold">Cash Flow</h1>
          <p className="text-sm text-slate-500 mt-1">Fifth Third and Chase, tracked independently, plus credit card capacity and the weekly Friday review.</p>
        </header>

        {loading ? <p className="text-slate-400 text-sm">Loading…</p> : (
          <div className="max-w-5xl">
            <div className="mb-4 flex flex-wrap gap-2">
              <button onClick={() => setActiveTab("overview")} className="px-4 py-2 text-sm font-semibold transition rounded-lg border-2"
                style={activeTab === "overview" ? { backgroundColor: "#e8622a", color: "white", borderColor: "#e8622a" } : { backgroundColor: "#d1fae5", color: "#065f46", borderColor: "#065f46" }}>Overview</button>
              <button onClick={() => setActiveTab("entry")} className="px-4 py-2 text-sm font-semibold transition rounded-lg border-2"
                style={activeTab === "entry" ? { backgroundColor: "#e8622a", color: "white", borderColor: "#e8622a" } : updateNumbersNeedsAttention ? { backgroundColor: "#fee2e2", color: "#991b1b", borderColor: "#991b1b" } : { backgroundColor: "#d1fae5", color: "#065f46", borderColor: "#065f46" }}>
                {updateNumbersNeedsAttention && activeTab !== "entry" ? "⚠️ " : ""}Update Numbers
              </button>
              {cashAccounts.map((a) => (
                <button key={a.id} onClick={() => setActiveTab(a.id)} className="px-4 py-2 text-sm font-semibold transition rounded-lg border-2"
                  style={activeTab === a.id ? { backgroundColor: "#e8622a", color: "white", borderColor: "#e8622a" } : { backgroundColor: "#d1fae5", color: "#065f46", borderColor: "#065f46" }}>{a.name}</button>
              ))}
              <button onClick={() => setActiveTab("cards")} className="px-4 py-2 text-sm font-semibold transition rounded-lg border-2"
                style={activeTab === "cards" ? { backgroundColor: "#e8622a", color: "white", borderColor: "#e8622a" } : { backgroundColor: "#d1fae5", color: "#065f46", borderColor: "#065f46" }}>Credit Cards</button>
              <button onClick={() => setActiveTab("trends")} className="px-4 py-2 text-sm font-semibold transition rounded-lg border-2"
                style={activeTab === "trends" ? { backgroundColor: "#e8622a", color: "white", borderColor: "#e8622a" } : { backgroundColor: "#d1fae5", color: "#065f46", borderColor: "#065f46" }}>Trends</button>
            </div>

            {cashAccounts.map((a) => activeTab === a.id && (
              <AccountPanel key={a.id} account={a} allBills={bills} allPayments={payments} latestBalances={latestBalances} cards={creditCards} refreshAll={refresh} />
            ))}
            {activeTab === "cards" && (
              <CreditCardsPanel cards={creditCards} charges={cardCharges} cashAccounts={cashAccounts} latestBalances={latestBalances} allBills={bills} allPayments={payments} refreshAll={refresh} />
            )}
            {activeTab === "overview" && (
              <OverviewPanel cashAccounts={cashAccounts} cards={creditCards} charges={cardCharges} allBills={bills} allPayments={payments} latestBalances={latestBalances} onViewArDetails={() => setActiveTab("entry")} />
            )}
            {activeTab === "entry" && (
              <EntryPanel cashAccounts={cashAccounts} cards={creditCards} latestBalances={latestBalances} refreshAll={refresh} />
            )}
            {activeTab === "trends" && (
              <TrendsPanel cashAccounts={cashAccounts} cards={creditCards} refreshAll={refresh} />
            )}
          </div>
        )}
      </div>
    </main>
  );
}
