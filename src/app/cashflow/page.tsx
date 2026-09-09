"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import AppIdentityGate from "@/components/AppIdentityGate";
import AccessDenied from "@/components/AccessDenied";
import { formatMoney } from "@/lib/format";
import {
  RecurringBill, BillPayment, BalanceCheck, Occurrence, BillFrequency, BillCategory,
  loadRecurringBills, addRecurringBill, updateRecurringBill,
  loadBillPayments, saveBillPayment, deleteBillPayment,
  loadLatestBalance, loadBalanceHistory, addBalanceCheck,
  loadMinComfortableBalance, saveMinComfortableBalance,
  buildOccurrences, computeSafeToSpend, checkBillPayment, addDays,
} from "@/lib/cashflow";

const FREQ_LABELS: Record<BillFrequency, string> = { weekly: "Weekly", biweekly: "Biweekly", monthly: "Monthly" };
const todayStr = () => new Date().toISOString().split("T")[0];

function CashFlowPageBody() {
  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [payments, setPayments] = useState<BillPayment[]>([]);
  const [latestBalance, setLatestBalance] = useState<BalanceCheck | null>(null);
  const [balanceHistory, setBalanceHistory] = useState<BalanceCheck[]>([]);
  const [minComfortable, setMinComfortable] = useState(5000);
  const [loading, setLoading] = useState(true);

  const [newBalanceInput, setNewBalanceInput] = useState("");
  const [minComfortableInput, setMinComfortableInput] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  const [showAddBill, setShowAddBill] = useState(false);
  const [billForm, setBillForm] = useState<{ name: string; estimatedAmount: string; frequency: BillFrequency; anchorDate: string; category: BillCategory; categoryLabel: string }>({
    name: "", estimatedAmount: "", frequency: "monthly", anchorDate: todayStr(), category: "bill", categoryLabel: "",
  });

  const [checkAmount, setCheckAmount] = useState("");
  const [checkDate, setCheckDate] = useState(todayStr());
  const [checkResult, setCheckResult] = useState<ReturnType<typeof checkBillPayment> | null>(null);

  const [markPayingFor, setMarkPayingFor] = useState<{ billId: string; dueDate: string; estimated: number } | null>(null);
  const [markAmount, setMarkAmount] = useState("");

  const WINDOW_DAYS = 60;

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    const today = todayStr();
    const rangeEnd = addDays(today, WINDOW_DAYS);
    const [b, p, lb, hist, minC] = await Promise.all([
      loadRecurringBills(),
      loadBillPayments(today, rangeEnd),
      loadLatestBalance(),
      loadBalanceHistory(10),
      loadMinComfortableBalance(),
    ]);
    setBills(b);
    setPayments(p);
    setLatestBalance(lb);
    setBalanceHistory(hist);
    setMinComfortable(minC);
    setLoading(false);
  }

  const today = todayStr();
  const occurrences: Occurrence[] = buildOccurrences(bills, payments, today, addDays(today, WINDOW_DAYS));
  const currentBalance = latestBalance?.balance ?? 0;
  const safeToSpend14 = computeSafeToSpend(currentBalance, today, occurrences, 14);
  const safeToSpend30 = computeSafeToSpend(currentBalance, today, occurrences, 30);

  async function handleUpdateBalance() {
    const amount = Number(newBalanceInput);
    if (!newBalanceInput || isNaN(amount)) return;
    await addBalanceCheck(amount);
    setNewBalanceInput("");
    await refresh();
  }

  async function handleSaveMinComfortable() {
    const amount = Number(minComfortableInput);
    if (!minComfortableInput || isNaN(amount)) return;
    await saveMinComfortableBalance(amount);
    setMinComfortableInput("");
    setSavedMsg("Saved.");
    await refresh();
  }

  async function handleAddBill() {
    const amount = Number(billForm.estimatedAmount);
    if (!billForm.name.trim() || !amount || !billForm.anchorDate) return;
    await addRecurringBill({
      name: billForm.name.trim(), estimatedAmount: amount, frequency: billForm.frequency,
      anchorDate: billForm.anchorDate, category: billForm.category, categoryLabel: billForm.categoryLabel.trim() || undefined, active: true,
    });
    setBillForm({ name: "", estimatedAmount: "", frequency: "monthly", anchorDate: todayStr(), category: "bill", categoryLabel: "" });
    setShowAddBill(false);
    await refresh();
  }

  async function handleDeactivateBill(id: string) {
    if (!confirm("Remove this recurring bill? It will stop appearing in the upcoming timeline.")) return;
    await updateRecurringBill(id, { active: false });
    await refresh();
  }

  function startMarkPaid(occ: Occurrence) {
    setMarkPayingFor({ billId: occ.billId, dueDate: occ.dueDate, estimated: occ.amount });
    setMarkAmount(String(occ.amount));
  }

  async function handleConfirmMarkPaid() {
    if (!markPayingFor) return;
    const amount = Number(markAmount);
    if (!amount) return;
    await saveBillPayment(markPayingFor.billId, markPayingFor.dueDate, amount);
    setMarkPayingFor(null);
    setMarkAmount("");
    await refresh();
  }

  async function handleUnmarkPaid(occ: Occurrence) {
    await deleteBillPayment(occ.billId, occ.dueDate);
    await refresh();
  }

  function handleCheckBill() {
    const amount = Number(checkAmount);
    if (!amount || !checkDate) { setCheckResult(null); return; }
    const result = checkBillPayment(currentBalance, today, occurrences, amount, checkDate, minComfortable);
    setCheckResult(result);
  }

  const safeColor = (val: number) => val >= minComfortable ? "#10b981" : val >= 0 ? "#f59e0b" : "#ef4444";

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-16 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <header className="mb-4">
          <h1 className="text-2xl font-bold">Cash Flow</h1>
          <p className="text-sm text-slate-500 mt-1">Know what's actually safe to spend before writing a check.</p>
        </header>

        {loading ? <p className="text-slate-400 text-sm">Loading…</p> : (
          <div className="max-w-5xl space-y-6">

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl bg-white p-5 shadow sm:col-span-1">
                <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold">Current Balance</p>
                <p className="text-3xl font-bold text-slate-700 mt-1">${formatMoney(currentBalance)}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {latestBalance ? `Checked ${new Date(latestBalance.checkedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "No balance entered yet"}
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <input type="number" onFocus={(e) => e.target.select()} value={newBalanceInput} onChange={(e) => setNewBalanceInput(e.target.value)}
                    placeholder="New balance" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                  <button onClick={handleUpdateBalance} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white whitespace-nowrap hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>
                    Update
                  </button>
                </div>
              </div>

              <div className="rounded-2xl p-5 shadow" style={{ background: `linear-gradient(135deg, ${safeColor(safeToSpend14)}22, ${safeColor(safeToSpend14)}44)` }}>
                <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Safe to Spend (14 days)</p>
                <p className="text-3xl font-bold mt-1" style={{ color: safeColor(safeToSpend14) }}>${formatMoney(safeToSpend14)}</p>
                <p className="text-xs text-slate-500 mt-1">After everything due in the next 2 weeks</p>
              </div>

              <div className="rounded-2xl p-5 shadow" style={{ background: `linear-gradient(135deg, ${safeColor(safeToSpend30)}22, ${safeColor(safeToSpend30)}44)` }}>
                <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Safe to Spend (30 days)</p>
                <p className="text-3xl font-bold mt-1" style={{ color: safeColor(safeToSpend30) }}>${formatMoney(safeToSpend30)}</p>
                <p className="text-xs text-slate-500 mt-1">After everything due in the next month</p>
              </div>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow">
              <h2 className="font-bold text-slate-700 mb-2 text-sm">Minimum Comfortable Balance</h2>
              <p className="text-xs text-slate-400 mb-2">The cushion you never want to dip below. Currently: <strong>${formatMoney(minComfortable)}</strong></p>
              <div className="flex items-center gap-2 max-w-xs">
                <input type="number" onFocus={(e) => e.target.select()} value={minComfortableInput} onChange={(e) => setMinComfortableInput(e.target.value)}
                  placeholder="New minimum" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                <button onClick={handleSaveMinComfortable} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white whitespace-nowrap hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>
                  Save
                </button>
              </div>
              {savedMsg && <span className="text-xs text-slate-400 mt-1 block">{savedMsg}</span>}
            </div>

            <div className="rounded-2xl bg-white p-5 shadow">
              <h2 className="font-bold text-slate-700 mb-3">Check a Bill Before Paying</h2>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-0.5">Amount</label>
                  <input type="number" onFocus={(e) => e.target.select()} value={checkAmount} onChange={(e) => setCheckAmount(e.target.value)}
                    className="w-32 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-0.5">Intended Pay Date</label>
                  <input type="date" value={checkDate} onChange={(e) => setCheckDate(e.target.value)}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                </div>
                <button onClick={handleCheckBill} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>
                  Check
                </button>
              </div>

              {checkResult && (
                <div className="mt-4 rounded-xl p-4" style={{ background: checkResult.safe ? "#d1fae5" : "#fee2e2" }}>
                  {checkResult.safe ? (
                    <p className="text-emerald-800 font-semibold">✅ Safe to pay — projected balance afterward: ${formatMoney(checkResult.projectedBalance)}</p>
                  ) : (
                    <>
                      <p className="text-red-700 font-semibold">⚠️ This would bring your balance to ${formatMoney(checkResult.projectedBalance)} — below your ${formatMoney(minComfortable)} minimum.</p>
                      {checkResult.suggestedDate ? (
                        <p className="text-red-700 text-sm mt-1">
                          Suggested: pay on <strong>{new Date(checkResult.suggestedDate + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" })}</strong> instead
                          {" "}— projected balance then: ${formatMoney(checkResult.suggestedBalance ?? 0)}.
                        </p>
                      ) : (
                        <p className="text-red-700 text-sm mt-1">No safe date found in the next 60 days based on what's currently scheduled.</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-white p-5 shadow">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-slate-700">Recurring Bills & Draws</h2>
                <button onClick={() => setShowAddBill((s) => !s)} className="text-sm font-semibold text-orange-500 hover:underline">
                  {showAddBill ? "Cancel" : "+ Add Bill"}
                </button>
              </div>

              {showAddBill && (
                <div className="rounded-xl bg-slate-50 p-3 mb-3 grid gap-2 sm:grid-cols-2">
                  <input type="text" placeholder="Name (e.g. Rent, Payroll)" value={billForm.name} onChange={(e) => setBillForm((f) => ({ ...f, name: e.target.value }))}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                  <input type="number" onFocus={(e) => e.target.select()} placeholder="Estimated amount" value={billForm.estimatedAmount} onChange={(e) => setBillForm((f) => ({ ...f, estimatedAmount: e.target.value }))}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                  <select value={billForm.frequency} onChange={(e) => setBillForm((f) => ({ ...f, frequency: e.target.value as BillFrequency }))}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none bg-white">
                    <option value="monthly">Monthly</option>
                    <option value="biweekly">Biweekly</option>
                    <option value="weekly">Weekly</option>
                  </select>
                  <input type="date" value={billForm.anchorDate} onChange={(e) => setBillForm((f) => ({ ...f, anchorDate: e.target.value }))}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                  <select value={billForm.category} onChange={(e) => setBillForm((f) => ({ ...f, category: e.target.value as BillCategory }))}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none bg-white">
                    <option value="bill">Bill</option>
                    <option value="payroll">Payroll</option>
                  </select>
                  <input type="text" placeholder="Category label (e.g. Rent, Lab, Software)" value={billForm.categoryLabel} onChange={(e) => setBillForm((f) => ({ ...f, categoryLabel: e.target.value }))}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
                  <button onClick={handleAddBill} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>
                    Add
                  </button>
                </div>
              )}

              {bills.filter((b) => b.active).length === 0 ? (
                <p className="text-sm text-slate-400">No recurring bills set up yet — add rent, loan payments, insurance, or payroll draws to get projections going.</p>
              ) : (
                <div className="space-y-1.5">
                  {bills.filter((b) => b.active).map((b) => (
                    <div key={b.id} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
                      <span className="font-medium text-slate-700">{b.name} <span className="text-slate-400 font-normal">({FREQ_LABELS[b.frequency]}{b.categoryLabel ? ` · ${b.categoryLabel}` : b.category === "payroll" ? " · Payroll" : ""})</span></span>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-500">~${formatMoney(b.estimatedAmount)}</span>
                        <button onClick={() => handleDeactivateBill(b.id)} className="text-xs text-red-400 hover:underline">Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-white shadow overflow-hidden">
              <h2 className="font-bold text-slate-700 p-5 pb-2">Next {WINDOW_DAYS} Days</h2>
              {occurrences.length === 0 ? (
                <p className="text-sm text-slate-400 px-5 pb-5">Nothing scheduled — add recurring bills above to see them here.</p>
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
                      {occurrences.map((occ) => (
                        <tr key={`${occ.billId}-${occ.dueDate}`} className="border-b border-slate-50 last:border-0">
                          <td className="px-5 py-2 text-slate-600 whitespace-nowrap">{new Date(occ.dueDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                          <td className="px-2 py-2 font-medium text-slate-700">{occ.billName}</td>
                          <td className="px-2 py-2 text-slate-600">${formatMoney(occ.amount)}</td>
                          <td className="px-2 py-2">
                            {occ.isPaid ? <span className="text-emerald-600 text-xs font-semibold">✓ Actual</span> : <span className="text-slate-400 text-xs">Estimated</span>}
                          </td>
                          <td className="px-5 py-2 text-right">
                            {markPayingFor?.billId === occ.billId && markPayingFor?.dueDate === occ.dueDate ? (
                              <div className="flex items-center gap-1 justify-end">
                                <input type="number" onFocus={(e) => e.target.select()} value={markAmount} onChange={(e) => setMarkAmount(e.target.value)}
                                  className="w-20 rounded border border-slate-200 px-1.5 py-0.5 text-xs focus:outline-none" />
                                <button onClick={handleConfirmMarkPaid} className="text-xs text-white px-2 py-0.5 rounded" style={{ backgroundColor: "#e8622a" }}>Save</button>
                                <button onClick={() => setMarkPayingFor(null)} className="text-xs text-slate-400">✕</button>
                              </div>
                            ) : occ.isPaid ? (
                              <button onClick={() => handleUnmarkPaid(occ)} className="text-xs text-slate-400 hover:underline">Undo</button>
                            ) : (
                              <button onClick={() => startMarkPaid(occ)} className="text-xs text-orange-500 hover:underline">Mark Paid</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {balanceHistory.length > 0 && (
              <div className="rounded-2xl bg-white p-5 shadow">
                <h2 className="font-bold text-slate-700 mb-2 text-sm">Balance Check-In History</h2>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {balanceHistory.map((h) => (
                    <div key={h.id} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-1.5">
                      <span className="text-slate-500">{new Date(h.checkedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                      <span className="font-semibold text-slate-700">${formatMoney(h.balance)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default function CashFlowPage() {
  return (
    <AppIdentityGate>
      {(identity, logout) => identity.canManagePayroll ? <CashFlowPageBody /> : <AccessDenied logout={logout} />}
    </AppIdentityGate>
  );
}
