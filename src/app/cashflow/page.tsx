"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { formatMoney } from "@/lib/format";
import {
  RecurringBill, BillPayment, BalanceCheck, Occurrence, BillFrequency, BillCategory,
  CashAccount, CreditCard, CardCharge, WeeklyCashReview,
  loadRecurringBills, addRecurringBill, updateRecurringBill,
  loadBillPayments, saveBillPayment, deleteBillPayment,
  loadLatestBalances, addBalanceCheck,
  loadCashAccounts, updateCashAccountCushion,
  loadCreditCards, updateStatementBalance,
  loadCardCharges, addCardCharge, updateCardCharge, deleteCardCharge,
  loadLatestWeeklyReview, loadWeeklyReviewHistory, saveWeeklyReview,
  buildOccurrences, computeSafeToSpend, addDays, checkBillPayment, projectBalance,
  computeAccountForecast, computeSuggestedTransfer, computeCardRecommendation,
} from "@/lib/cashflow";

const FREQ_LABELS: Record<BillFrequency, string> = { weekly: "Weekly", biweekly: "Biweekly", monthly: "Monthly", once: "One-time" };
const WINDOW_DAYS = 60;

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function safeColor(amount: number): string {
  if (amount < 0) return "#dc2626";
  if (amount < 3000) return "#f59e0b";
  return "#059669";
}

// ---------------- Account Panel ----------------

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
            <input type="number" onFocus={(e) => e.target.select()} value={balanceInput} onChange={(e) => setBalanceInput(e.target.value)} placeholder="New balance"
              className="w-32 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            <button onClick={handleUpdateBalance} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>Update</button>
          </div>
        </div>
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
              <label className="block text-xs text-slate-400 mb-0.5">Name</label>
              <input type="text" value={billForm.name} onChange={(e) => setBillForm((f) => ({ ...f, name: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-0.5">Estimated Amount</label>
              <input type="number" onFocus={(e) => e.target.select()} value={billForm.estimatedAmount} onChange={(e) => setBillForm((f) => ({ ...f, estimatedAmount: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-0.5">Direction</label>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden w-fit">
                <button type="button" onClick={() => setBillForm((f) => ({ ...f, direction: "outflow" }))} className="px-3 py-1.5 text-sm font-medium transition" style={billForm.direction === "outflow" ? { backgroundColor: "#e8622a", color: "white" } : { color: "#6b7280" }}>Money Out</button>
                <button type="button" onClick={() => setBillForm((f) => ({ ...f, direction: "inflow" }))} className="px-3 py-1.5 text-sm font-medium transition" style={billForm.direction === "inflow" ? { backgroundColor: "#059669", color: "white" } : { color: "#6b7280" }}>Money In</button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-0.5">Priority</label>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden w-fit">
                <button type="button" onClick={() => setBillForm((f) => ({ ...f, essential: true }))} className="px-3 py-1.5 text-sm font-medium transition" style={billForm.essential ? { backgroundColor: "#dc2626", color: "white" } : { color: "#6b7280" }}>Essential</button>
                <button type="button" onClick={() => setBillForm((f) => ({ ...f, essential: false }))} className="px-3 py-1.5 text-sm font-medium transition" style={!billForm.essential ? { backgroundColor: "#64748b", color: "white" } : { color: "#6b7280" }}>Discretionary</button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-0.5">Frequency</label>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden w-fit">
                {(["monthly", "biweekly", "weekly", "once"] as BillFrequency[]).map((f) => (
                  <button key={f} type="button" onClick={() => setBillForm((form) => ({ ...form, frequency: f }))} className="px-3 py-1.5 text-sm font-medium transition"
                    style={billForm.frequency === f ? { backgroundColor: "#e8622a", color: "white" } : { color: "#6b7280" }}>{FREQ_LABELS[f]}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-0.5">{billForm.frequency === "once" ? "Due Date" : "First/Next Due Date"}</label>
              <input type="date" value={billForm.anchorDate} onChange={(e) => setBillForm((f) => ({ ...f, anchorDate: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-400 mb-0.5">Category (optional)</label>
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
    await updateStatementBalance(card.id, amount);
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

  return (
    <div className="space-y-4">
      {cards.map((card) => {
        const balance = latestBalances[card.name]?.balance ?? 0;
        const linkedAccount = cashAccounts.find((a) => a.id === card.linkedCashAccountId);
        let accountForecast = null;
        if (linkedAccount) {
          const accountBills = allBills.filter((b) => b.cashAccountId === linkedAccount.id);
          const occurrences = buildOccurrences(accountBills, allPayments, today.slice(0, 8) + "01", addDays(today, WINDOW_DAYS));
          accountForecast = computeAccountForecast(linkedAccount, latestBalances[linkedAccount.name]?.balance ?? 0, occurrences, today, 0);
        }
        const rec = computeCardRecommendation(card, balance, charges, today, accountForecast);
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
                <label className="block text-xs text-slate-400 mb-0.5">Update Current Balance</label>
                <div className="flex items-center gap-2">
                  <input type="number" onFocus={(e) => e.target.select()} value={balanceInputs[card.id] ?? ""} onChange={(e) => setBalanceInputs((f) => ({ ...f, [card.id]: e.target.value }))}
                    placeholder="New balance" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                  <button onClick={() => handleUpdateBalance(card)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white whitespace-nowrap hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>Update</button>
                </div>
              </div>
              <div>
                <label className="block text-xs mb-0.5">
                  <span className={rec.statementStale ? "text-amber-600 font-semibold" : "text-slate-400"}>
                    Statement Balance {rec.statementStale ? "⚠️ Update due" : `— $${formatMoney(card.statementBalance)}`}
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <input type="number" onFocus={(e) => e.target.select()} value={stmtInputs[card.id] ?? ""} onChange={(e) => setStmtInputs((f) => ({ ...f, [card.id]: e.target.value }))}
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

function WeeklyReviewPanel({ cashAccounts, cards, charges, allBills, allPayments, latestBalances, refreshAll }: {
  cashAccounts: CashAccount[]; cards: CreditCard[]; charges: CardCharge[]; allBills: RecurringBill[]; allPayments: BillPayment[];
  latestBalances: Record<string, BalanceCheck>; refreshAll: () => void;
}) {
  const [latestReview, setLatestReview] = useState<WeeklyCashReview | null>(null);
  const [history, setHistory] = useState<WeeklyCashReview[]>([]);
  const [projectedProduction, setProjectedProduction] = useState("");
  const [currentIncome, setCurrentIncome] = useState("");
  const [currentPatientIncome, setCurrentPatientIncome] = useState("");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const [balanceInputs, setBalanceInputs] = useState<Record<string, string>>({});
  const [stmtInputs, setStmtInputs] = useState<Record<string, string>>({});
  const [balancesSaved, setBalancesSaved] = useState(false);

  useEffect(() => {
    Promise.all([loadLatestWeeklyReview(), loadWeeklyReviewHistory(8)]).then(([latest, hist]) => {
      setLatestReview(latest);
      setHistory(hist);
      if (latest) {
        setProjectedProduction(latest.projectedTotalProduction != null ? String(latest.projectedTotalProduction) : "");
        setCurrentIncome(latest.currentIncome != null ? String(latest.currentIncome) : "");
        setCurrentPatientIncome(latest.currentPatientIncome != null ? String(latest.currentPatientIncome) : "");
        setNotes(latest.notes);
      }
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
  const productionNum = projectedProduction ? Number(projectedProduction) : null;
  const incomeNum = currentIncome ? Number(currentIncome) : null;
  const patientIncomeNum = currentPatientIncome ? Number(currentPatientIncome) : null;
  const insuranceIncome = incomeNum != null && patientIncomeNum != null ? incomeNum - patientIncomeNum : null;

  async function handleSave() {
    await saveWeeklyReview({
      reviewDate: today, projectedTotalProduction: productionNum, currentIncome: incomeNum,
      currentPatientIncome: patientIncomeNum, notes,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    const [latest, hist] = await Promise.all([loadLatestWeeklyReview(), loadWeeklyReviewHistory(8)]);
    setLatestReview(latest);
    setHistory(hist);
  }

  async function handleSaveAllBalances() {
    const jobs: Promise<void>[] = [];
    for (const acct of cashAccounts) {
      const raw = balanceInputs[acct.id];
      if (raw && !isNaN(Number(raw))) jobs.push(addBalanceCheck(acct.name, Number(raw)));
    }
    for (const card of cards) {
      const rawBal = balanceInputs[card.id];
      if (rawBal && !isNaN(Number(rawBal))) jobs.push(addBalanceCheck(card.name, Number(rawBal)));
      const rawStmt = stmtInputs[card.id];
      if (rawStmt && !isNaN(Number(rawStmt))) jobs.push(updateStatementBalance(card.id, Number(rawStmt)));
    }
    await Promise.all(jobs);
    setBalanceInputs({});
    setStmtInputs({});
    setBalancesSaved(true);
    setTimeout(() => setBalancesSaved(false), 3000);
    refreshAll();
  }

  const [checkAccountId, setCheckAccountId] = useState("");
  const [checkSelection, setCheckSelection] = useState(""); // occurrence key, or "new"
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
      <div className="rounded-2xl bg-white shadow p-5">
        <h2 className="font-bold text-slate-700 mb-1">Update All Balances</h2>
        <p className="text-xs text-slate-400 mb-4">One place to update everything for this week — these are the same numbers shown on each account/card's own tab, so updating here updates everywhere.</p>
        <div className="grid gap-3 sm:grid-cols-2 mb-3">
          {cashAccounts.map((acct) => (
            <div key={acct.id}>
              <label className="block text-xs text-slate-400 mb-0.5">{acct.name} Balance <span className="text-slate-300">— current: ${formatMoney(latestBalances[acct.name]?.balance ?? 0)}</span></label>
              <input type="number" onFocus={(e) => e.target.select()} value={balanceInputs[acct.id] ?? ""} onChange={(e) => setBalanceInputs((f) => ({ ...f, [acct.id]: e.target.value }))}
                placeholder="New balance" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map((card) => (
            <div key={card.id} className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-600 mb-2">{card.name}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-0.5">Current Balance <span className="text-slate-300">— ${formatMoney(latestBalances[card.name]?.balance ?? 0)}</span></label>
                  <input type="number" onFocus={(e) => e.target.select()} value={balanceInputs[card.id] ?? ""} onChange={(e) => setBalanceInputs((f) => ({ ...f, [card.id]: e.target.value }))}
                    placeholder="New balance" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-0.5">Statement Balance <span className="text-slate-300">— ${formatMoney(card.statementBalance)}</span></label>
                  <input type="number" onFocus={(e) => e.target.select()} value={stmtInputs[card.id] ?? ""} onChange={(e) => setStmtInputs((f) => ({ ...f, [card.id]: e.target.value }))}
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
      </div>

      <div className="rounded-2xl bg-white shadow p-5">
        <h2 className="font-bold text-slate-700 mb-1">This Week's Open Dental Numbers</h2>
        <p className="text-xs text-slate-400 mb-4">Enter your projected month-end production and current collections — insurance income is calculated for you.</p>
        <div className="grid gap-3 sm:grid-cols-2 mb-4">
          <div>
            <label className="block text-xs text-slate-400 mb-0.5">Projected Total Production (month-end estimate)</label>
            <input type="number" onFocus={(e) => e.target.select()} value={projectedProduction} onChange={(e) => setProjectedProduction(e.target.value)} placeholder="$" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-0.5">Current Income (patient + insurance, so far this month)</label>
            <input type="number" onFocus={(e) => e.target.select()} value={currentIncome} onChange={(e) => setCurrentIncome(e.target.value)} placeholder="$" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-0.5">Current Patient Income (so far this month)</label>
            <input type="number" onFocus={(e) => e.target.select()} value={currentPatientIncome} onChange={(e) => setCurrentPatientIncome(e.target.value)} placeholder="$" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-0.5">Insurance Income <span className="text-slate-300">(calculated)</span></label>
            <div className="w-full rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5 text-sm text-slate-600">
              {insuranceIncome != null ? `$${formatMoney(insuranceIncome)}` : "—"}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs text-slate-400 mb-0.5">Notes (optional)</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
          </div>
        </div>
        <button onClick={handleSave} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>Save This Week's Review</button>
        {saved && <span className="ml-3 text-xs text-emerald-600 font-semibold">✓ Saved</span>}
      </div>

      <div className="rounded-2xl p-5 shadow" style={{ background: "linear-gradient(135deg, #e0f2fe, #bae6fd)" }}>
        <h2 className="font-bold text-slate-700 mb-1">Check a Bill Before Paying</h2>
        <p className="text-xs text-slate-500 mb-4">Pick an already-scheduled transaction to see if it's still safe to pay as planned, or check a brand-new one-off payment that isn't in the system yet.</p>
        <div className="grid gap-3 sm:grid-cols-2 mb-3">
          <div>
            <label className="block text-xs text-slate-500 mb-0.5">Account</label>
            <select value={checkAccountId} onChange={(e) => { setCheckAccountId(e.target.value); setCheckSelection(""); setCheckResult(null); }}
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none bg-white">
              <option value="">Select an account…</option>
              {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          {checkAccount && (
            <div>
              <label className="block text-xs text-slate-500 mb-0.5">Which transaction?</label>
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
            <label className="block text-xs text-slate-500 mb-0.5">Override amount (optional — leave blank to check the scheduled estimate as-is)</label>
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

      {ffForecast && chaseForecast && (
        <div className="grid gap-4 sm:grid-cols-2">
          {[ffForecast, chaseForecast].map((f) => (
            <div key={f.accountId} className="rounded-2xl p-5 shadow" style={{ background: `linear-gradient(135deg, ${safeColor(f.excessOrShortfall)}22, ${safeColor(f.excessOrShortfall)}44)` }}>
              <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">{f.accountName} — Forecast Excess/(Shortfall)</p>
              <p className="text-2xl font-bold mt-1" style={{ color: safeColor(f.excessOrShortfall) }}>${formatMoney(f.excessOrShortfall)}</p>
              <div className="text-xs text-slate-500 mt-2 space-y-0.5">
                <p>Balance: ${formatMoney(f.currentBalance)} + Deposits (14d): ${formatMoney(f.expectedDeposits14d)}</p>
                <p>− Obligations (14d): ${formatMoney(f.obligations14d)} − Cushion: ${formatMoney(f.cushion)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {transfer && (
        <div className="rounded-2xl p-5 shadow" style={{ background: transfer.amount > 0 ? "linear-gradient(135deg, #dbeafe, #bfdbfe)" : "#f8fafc" }}>
          <h3 className="font-bold text-slate-700 text-sm mb-1">Transfer Recommendation</h3>
          {transfer.amount > 0 ? (
            <p className="text-sm text-blue-900"><strong>Transfer ${formatMoney(transfer.amount)}</strong> from {transfer.fromAccountName} to {transfer.toAccountName}. {transfer.reason}</p>
          ) : (
            <p className="text-sm text-slate-500">{transfer.reason}</p>
          )}
        </div>
      )}

      <div className="rounded-2xl bg-white shadow p-5">
        <h3 className="font-bold text-slate-700 text-sm mb-3">Production & Collections Pace</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-slate-400">Projected Production vs ~${formatMoney(productionTarget)}/month target</p>
            <p className="text-xl font-bold" style={{ color: productionNum != null && productionNum >= productionTarget ? "#059669" : "#f59e0b" }}>{productionNum != null ? `$${formatMoney(productionNum)}` : "Not entered"}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Current Income vs ~${formatMoney(collectionsTarget)}/month target</p>
            <p className="text-xl font-bold" style={{ color: incomeNum != null && incomeNum >= collectionsTarget ? "#059669" : "#f59e0b" }}>{incomeNum != null ? `$${formatMoney(incomeNum)}` : "Not entered"}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Insurance Income (calculated)</p>
            <p className="text-xl font-bold text-slate-700">{insuranceIncome != null ? `$${formatMoney(insuranceIncome)}` : "Not entered"}</p>
          </div>
        </div>
        {incomeNum != null && productionNum != null && incomeNum < productionNum * 0.8 && (
          <p className="text-xs text-amber-600 mt-2">Collections are lagging materially behind production — consider reviewing insurance AR aging before discretionary spending.</p>
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

// ---------------- Main Page ----------------

export default function CashFlowPage() {
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [cardCharges, setCardCharges] = useState<CardCharge[]>([]);
  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [payments, setPayments] = useState<BillPayment[]>([]);
  const [latestBalances, setLatestBalances] = useState<Record<string, BalanceCheck>>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("");

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    const today = todayStr();
    const monthStart = today.slice(0, 8) + "01";
    const rangeEnd = addDays(today, WINDOW_DAYS);
    const [accounts, cards, charges, b, p, bal] = await Promise.all([
      loadCashAccounts(), loadCreditCards(), loadCardCharges(), loadRecurringBills(), loadBillPayments(monthStart, rangeEnd), loadLatestBalances(),
    ]);
    setCashAccounts(accounts);
    setCreditCards(cards);
    setCardCharges(charges);
    setBills(b);
    setPayments(p);
    setLatestBalances(bal);
    if (!activeTab) setActiveTab("review");
    setLoading(false);
  }

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-16 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <header className="mb-4">
          <h1 className="text-2xl font-bold">Cash Flow</h1>
          <p className="text-sm text-slate-500 mt-1">Fifth Third and Chase, tracked independently, plus credit card capacity and the weekly Friday review.</p>
        </header>

        {loading ? <p className="text-slate-400 text-sm">Loading…</p> : (
          <div className="max-w-5xl">
            <div className="mb-4 flex rounded-lg border border-slate-200 bg-white overflow-hidden w-fit flex-wrap">
              <button onClick={() => setActiveTab("review")} className="px-4 py-2 text-sm font-semibold transition"
                style={activeTab === "review" ? { backgroundColor: "#e8622a", color: "white" } : { color: "#6b7280" }}>Weekly Review</button>
              {cashAccounts.map((a) => (
                <button key={a.id} onClick={() => setActiveTab(a.id)} className="px-4 py-2 text-sm font-semibold transition"
                  style={activeTab === a.id ? { backgroundColor: "#e8622a", color: "white" } : { color: "#6b7280" }}>{a.name}</button>
              ))}
              <button onClick={() => setActiveTab("cards")} className="px-4 py-2 text-sm font-semibold transition"
                style={activeTab === "cards" ? { backgroundColor: "#e8622a", color: "white" } : { color: "#6b7280" }}>Credit Cards</button>
            </div>

            {cashAccounts.map((a) => activeTab === a.id && (
              <AccountPanel key={a.id} account={a} allBills={bills} allPayments={payments} latestBalances={latestBalances} cards={creditCards} refreshAll={refresh} />
            ))}
            {activeTab === "cards" && (
              <CreditCardsPanel cards={creditCards} charges={cardCharges} cashAccounts={cashAccounts} latestBalances={latestBalances} allBills={bills} allPayments={payments} refreshAll={refresh} />
            )}
            {activeTab === "review" && (
              <WeeklyReviewPanel cashAccounts={cashAccounts} cards={creditCards} charges={cardCharges} allBills={bills} allPayments={payments} latestBalances={latestBalances} refreshAll={refresh} />
            )}
          </div>
        )}
      </div>
    </main>
  );
}
