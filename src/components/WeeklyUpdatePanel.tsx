"use client";

import { useState, useEffect } from "react";
import { formatMoney, formatUSD } from "@/lib/format";
import DebtPanel from "@/components/DebtPanel";
import { previousMonth } from "@/lib/staleness";
import CardChargesPanel from "@/components/CardChargesPanel";
import BackfillPanel from "@/components/BackfillPanel";
import { Debt } from "@/lib/debt";
import { HistoryBlock, HistoryButton, MonthSelect, NumInput, UpdatedStamp, monthLabel, HistRow } from "@/components/CashHistory";
import {
  CashAccount, CreditCard, CardCharge, RecurringBill, BillPayment, BalanceCheck, WeeklyCashReview, ArAgingEntry, BankStatementEntry, GoalProgress,
  addBalanceCheck, loadBalanceHistoryForAccount, deleteBalanceCheck, updateBalanceCheckAmount, updateBankStatementEntryAmount,
  updateBankStatementBalance, loadStatementHistoryForAccount, backfillBankStatementMonth, deleteBankStatementEntry,
  loadLatestWeeklyReview, loadWeeklyReviewHistory, saveWeeklyReview, deleteWeeklyReview,
  loadLatestArAging, loadArAgingHistory, saveArAgingEntry, deleteArAgingEntry,
  computeArHealth, computeAvgMonthlyProduction, withCurrentMonthProjection,
  loadProductionGoal, saveProductionGoal, computeGoalProgress, loadDentalMonthlyHistory,
} from "@/lib/cashflow";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const m0 = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const ymdLabel = (ymd: string, year = false) =>
  new Date(ymd + "T00:00:00").toLocaleDateString("en-US", year ? { month: "short", day: "numeric", year: "2-digit" } : { month: "short", day: "numeric" });

const inp = "w-full rounded border border-slate-200 px-1.5 py-1 text-xs focus:outline-none";
const calc = "w-full rounded border border-slate-100 bg-slate-50 px-1.5 py-1 text-xs text-slate-600 whitespace-nowrap overflow-hidden";
const card = "rounded-2xl bg-white shadow px-4 py-3";

function Field({ label, title, width, children }: { label: React.ReactNode; title?: string; width?: number; children: React.ReactNode }) {
  return (
    <div style={width ? { width } : { flex: 1, minWidth: 120 }} title={title}>
      <label className="block text-[11px] text-slate-500 font-medium mb-0.5 whitespace-nowrap">{label}</label>
      {children}
    </div>
  );
}

const BANK_GRID = "minmax(130px,1.2fr) 110px 196px 110px 56px";

export default function WeeklyUpdatePanel({
  cashAccounts, cards, latestBalances, refreshAll, debtMonthlyCollections, charges, allBills, allPayments, loans,
}: {
  loans: Debt[];
  cashAccounts: CashAccount[];
  charges: CardCharge[];
  allBills: RecurringBill[];
  allPayments: BillPayment[];
  cards: CreditCard[];
  latestBalances: Record<string, BalanceCheck>;
  refreshAll: () => void;
  debtMonthlyCollections?: number | null;
}) {
  const today = todayStr();

  // ---------------- Bank balances ----------------
  const [balanceInputs, setBalanceInputs] = useState<Record<string, string>>({});
  const [stmtInputs, setStmtInputs] = useState<Record<string, string>>({});
  const [bankMonths, setBankMonths] = useState<Record<string, string>>({});
  const [bankHist, setBankHist] = useState<Record<string, BankStatementEntry[]>>({});
  const [balancesSaved, setBalancesSaved] = useState(false);
  const [balancesError, setBalancesError] = useState<string | null>(null);
  const [savingBalances, setSavingBalances] = useState(false);
  const [openBankHist, setOpenBankHist] = useState<string | null>(null);

  async function loadBankStatements() {
    const all = await Promise.all(cashAccounts.map((a) => loadStatementHistoryForAccount(a.id)));
    const map: Record<string, BankStatementEntry[]> = {};
    cashAccounts.forEach((a, i) => { map[a.id] = all[i]; }); // newest month first
    setBankHist(map);
  }
  useEffect(() => { loadBankStatements(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function bankWhen(acctId: string, checkedAt?: string): string | null {
    const stamps = [checkedAt, (bankHist[acctId] ?? [])[0]?.enteredAt].filter((t): t is string => !!t);
    return stamps.length ? stamps.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null;
  }

  const balancesDirty = Object.keys(balanceInputs).length > 0 || Object.keys(stmtInputs).length > 0;

  async function handleSaveBalances() {
    setSavingBalances(true);
    const jobs: { label: string; promise: Promise<{ ok: boolean; error?: string }> }[] = [];
    for (const acct of cashAccounts) {
      const raw = balanceInputs[acct.id];
      if (raw && !isNaN(Number(raw))) jobs.push({ label: `${acct.name} balance`, promise: addBalanceCheck(acct.name, Number(raw)) });
      const rawStmt = stmtInputs[acct.id];
      if (rawStmt && !isNaN(Number(rawStmt))) {
        const month = bankMonths[acct.id] ?? bankHist[acct.id]?.[0]?.month ?? previousMonth();
        jobs.push({ label: `${acct.name} statement`, promise: updateBankStatementBalance(acct.id, Number(rawStmt), month) });
      }
    }
    const results = await Promise.all(jobs.map((j) => j.promise));
    const failures = jobs.filter((_, i) => !results[i].ok).map((j, _i) => j.label);
    setSavingBalances(false);
    if (failures.length > 0) {
      setBalancesError(`⚠️ Some saves failed: ${failures.join("; ")}`);
      setBalancesSaved(false);
      return;
    }
    setBalancesError(null);
    setBalanceInputs({});
    setStmtInputs({});
    setBankMonths({});
    setBalancesSaved(true);
    setTimeout(() => setBalancesSaved(false), 3000);
    refreshAll();
  }

  // ---------------- Open Dental numbers ----------------
  const [latestReview, setLatestReview] = useState<WeeklyCashReview | null>(null);
  const [projectedProduction, setProjectedProduction] = useState("");
  const [currentIncome, setCurrentIncome] = useState("");
  const [currentPatientIncome, setCurrentPatientIncome] = useState("");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);
  const [openOdHist, setOpenOdHist] = useState(false);

  // ---------------- A/R aging ----------------
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
  const [openArHist, setOpenArHist] = useState(false);
  const [showArWhy, setShowArWhy] = useState(false);

  // ---------------- Production goal ----------------
  const goalYear = new Date().getFullYear();
  const [goalInput, setGoalInput] = useState("");
  const [goalSaved, setGoalSaved] = useState(false);
  const [goalProgress, setGoalProgress] = useState<GoalProgress | null>(null);
  const [showGoalDetail, setShowGoalDetail] = useState(false);

  async function refreshGoal() {
    const [goal, history, review] = await Promise.all([
      loadProductionGoal(goalYear), loadDentalMonthlyHistory(), loadLatestWeeklyReview(),
    ]);
    setGoalInput(goal ? String(goal.annualGoal) : "");
    const merged = withCurrentMonthProjection(history, review);
    setGoalProgress(computeGoalProgress(goal?.annualGoal ?? 0, merged.map((e) => ({ month: e.month, netProduction: e.netProduction })), goalYear));
  }

  async function handleSaveGoal() {
    const amt = Number(goalInput);
    if (!amt || amt <= 0) return;
    const res = await saveProductionGoal(goalYear, amt);
    if (!res.ok) return;
    setGoalSaved(true);
    setTimeout(() => setGoalSaved(false), 2500);
    refreshGoal();
  }

  useEffect(() => {
    refreshGoal();
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
    Promise.all([loadDentalMonthlyHistory(), loadLatestWeeklyReview()]).then(([history, review]) => {
      setAvgMonthlyProduction(computeAvgMonthlyProduction(withCurrentMonthProjection(history, review)));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    setLatestReview(await loadLatestWeeklyReview());
    refreshAll();
  }

  const n = (s: string) => (s ? Number(s) : 0);
  const arRaw = n(ar0to30) + n(ar31to60) + n(ar61to90) + n(ar90plus);
  const arTrue = Math.max(0, arRaw - n(arWoEstimate));
  const arPatient = arTrue - n(arInsuranceEstimate);

  async function handleSaveAr() {
    const result = await saveArAgingEntry({
      entryDate: today,
      ar0to30: n(ar0to30), ar31to60: n(ar31to60), ar61to90: n(ar61to90), ar90plus: n(ar90plus),
      woEstimate: n(arWoEstimate), insuranceEstimate: n(arInsuranceEstimate),
    });
    if (!result.ok) { setArError(result.error ?? "Failed to save."); return; }
    setArError(null);
    setArSaved(true);
    setTimeout(() => setArSaved(false), 3000);
    setLatestArAging(await loadLatestArAging());
    refreshAll();
  }

  const health = computeArHealth(
    { ar0to30: n(ar0to30), ar31to60: n(ar31to60), ar61to90: n(ar61to90), ar90plus: n(ar90plus), woEstimate: n(arWoEstimate) },
    avgMonthlyProduction,
  );
  const healthVisible = !(health.totalAr <= 0 && !ar0to30 && !ar31to60 && !ar61to90 && !ar90plus);
  const hs = health.status === "good" ? { bg: "#d1fae5", color: "#065f46", ring: "#10b981", label: "✓ Healthy", icon: "💚" }
    : health.status === "fair" ? { bg: "#ffedd5", color: "#92400e", ring: "#f59e0b", label: "Needs attention", icon: "⚠️" }
    : { bg: "#fee2e2", color: "#991b1b", ring: "#dc2626", label: "Poor", icon: "🚨" };

  const hdr = "flex items-center justify-between gap-2 mb-2 flex-wrap";
  const saveBtn = (dirty: boolean) => ({ backgroundColor: dirty ? "#dc2626" : "#e8622a" });

  return (
    <div className="space-y-3">
      {/* ---------- Account balances (bank accounts; cards live in Debt below) ---------- */}
      <div className={card}>
        <div className={hdr}>
          <h2 className="font-bold text-sm text-slate-700">Account Balances</h2>
          <div className="flex items-center gap-2">
            {balancesDirty && <span className="text-xs text-red-600 font-semibold">⚠️ unsaved</span>}
            {balancesSaved && <span className="text-xs text-emerald-600 font-semibold">✓ Saved</span>}
            <button onClick={handleSaveBalances} disabled={savingBalances || !balancesDirty}
              className="rounded-lg px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40" style={saveBtn(balancesDirty)}>
              {savingBalances ? "Saving…" : "Save Balances"}
            </button>
          </div>
        </div>
        {balancesError && <p className="text-xs text-red-600 font-semibold mb-1">{balancesError}</p>}
        <div className="overflow-x-auto">
          <div style={{ minWidth: 560 }}>
            <div className="grid items-end gap-x-2 text-[11px] text-slate-400 font-medium border-b border-slate-100 pb-1" style={{ gridTemplateColumns: BANK_GRID }}>
              <span>Account</span><span>Current bal.</span><span>Statement Balance</span><span>Last update</span><span />
            </div>
            {cashAccounts.map((acct) => {
              const hist = bankHist[acct.id] ?? [];
              const latestMonth = hist[0]?.month;
              const covered = previousMonth();
              const selMonth = bankMonths[acct.id] ?? latestMonth ?? covered;
              const entryForSel = hist.find((h) => h.month === selMonth);
              const newerDue = latestMonth != null && covered > latestMonth && selMonth !== covered;
              const histOpen = openBankHist === acct.id;
              const last = latestBalances[acct.name];
              return (
                <div key={acct.id} className="border-b border-slate-50 last:border-0">
                  <div className="grid items-center gap-x-2 text-xs py-1" style={{ gridTemplateColumns: BANK_GRID }}>
                    <span className="font-medium text-slate-700 truncate" title={acct.name}>{acct.name}</span>
                    <NumInput onFocus={(e) => e.target.select()} className={inp}
                      value={balanceInputs[acct.id] ?? String(last?.balance ?? 0)}
                      onChange={(e) => setBalanceInputs((f) => ({ ...f, [acct.id]: e.target.value }))} />
                    <span className="flex items-center gap-1">
                      <MonthSelect value={selMonth} className="w-[74px] shrink-0"
                        onChange={(m) => {
                          setBankMonths((s) => ({ ...s, [acct.id]: m }));
                          setStmtInputs((s) => { const c = { ...s }; delete c[acct.id]; return c; });
                        }} />
                      <NumInput onFocus={(e) => e.target.select()} className={inp} placeholder="—"
                        value={stmtInputs[acct.id] ?? (entryForSel ? String(entryForSel.balance) : "")}
                        onChange={(e) => setStmtInputs((f) => ({ ...f, [acct.id]: e.target.value }))} />
                      {newerDue && (
                        <button title={`A ${monthLabel(covered)} statement should be out — click to enter it`}
                          onClick={() => setBankMonths((s) => ({ ...s, [acct.id]: covered }))}
                          className="text-[10px] font-semibold text-amber-600 whitespace-nowrap hover:underline">{monthLabel(covered).split(" ")[0]}?</button>
                      )}
                    </span>
                    <UpdatedStamp prefix="" when={bankWhen(acct.id, last?.checkedAt)} />
                    <span className="text-right"><HistoryButton open={histOpen} onClick={() => setOpenBankHist(histOpen ? null : acct.id)} /></span>
                  </div>
                  {histOpen && (
                    <div className="pb-2">
                      <HistoryBlock
                        onChanged={() => { loadBankStatements(); refreshAll(); }}
                        columns={[
                          {
                            title: "Current balance",
                            load: async () => (await loadBalanceHistoryForAccount(acct.name, 60)).map((b): HistRow => ({
                              id: b.id,
                              label: new Date(b.checkedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }),
                              value: formatUSD(b.balance), amount: b.balance,
                              onAmount: (n) => updateBalanceCheckAmount(b.id, n),
                              onDelete: () => deleteBalanceCheck(b.id),
                            })),
                          },
                          {
                            title: "Statement balance — by month covered",
                            load: async () => (await loadStatementHistoryForAccount(acct.id)).map((s): HistRow => ({
                              id: s.id, label: monthLabel(s.month), month: s.month, value: formatUSD(s.balance), amount: s.balance,
                              onAmount: (n) => updateBankStatementEntryAmount(s.id, n),
                              onMonth: async (m) => {
                                const clash = (await loadStatementHistoryForAccount(acct.id)).find((x) => x.month === m && x.id !== s.id);
                                if (clash && !confirm(`${monthLabel(m)} already has a statement on file ($${formatMoney(clash.balance)}). Replace it with $${formatMoney(s.balance)}?`)) return;
                                await backfillBankStatementMonth(acct.id, m, s.balance);
                                await deleteBankStatementEntry(s.id);
                              },
                              onDelete: () => deleteBankStatementEntry(s.id),
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
      </div>

      {/* ---------- Open Dental numbers — one row ---------- */}
      <div className={card}>
        <div className={hdr}>
          <h2 className="font-bold text-sm text-slate-700">Open Dental Numbers</h2>
          <div className="flex items-center gap-3 text-xs">
            <UpdatedStamp when={latestReview?.reviewDate} />
            <HistoryButton open={openOdHist} onClick={() => setOpenOdHist((o) => !o)} />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Projected production" title="Month-end estimate" width={124}>
            <NumInput onFocus={(e) => e.target.select()} value={projectedProduction} onChange={(e) => setProjectedProduction(e.target.value)} className={inp} />
          </Field>
          <Field label="Income to date" title="Patient + insurance, so far this month" width={112}>
            <NumInput onFocus={(e) => e.target.select()} value={currentIncome} onChange={(e) => setCurrentIncome(e.target.value)} className={inp} />
          </Field>
          <Field label="Patient income" title="So far this month" width={112}>
            <NumInput onFocus={(e) => e.target.select()} value={currentPatientIncome} onChange={(e) => setCurrentPatientIncome(e.target.value)} className={inp} />
          </Field>
          <Field label="Insurance (calc)" width={112}>
            <div className={calc}>{insuranceIncome != null ? m0(insuranceIncome) : "—"}</div>
          </Field>
          <Field label="Notes">
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className={inp} />
          </Field>
          <div className="flex items-center gap-2 pb-0.5">
            <button onClick={handleSave} className="rounded-lg px-3 py-1 text-xs font-semibold text-white hover:opacity-90 whitespace-nowrap" style={saveBtn(hasUnsavedIncomeChanges)}>
              {hasUnsavedIncomeChanges ? "Save — unsaved" : "Save"}
            </button>
            {saved && <span className="text-xs text-emerald-600 font-semibold">✓</span>}
          </div>
        </div>
        {openOdHist && (
          <div className="mt-2">
            <HistoryBlock
              columns={[{
                title: "Weekly entries",
                load: async () => (await loadWeeklyReviewHistory(52)).map((r): HistRow => ({
                  id: r.id, label: ymdLabel(r.reviewDate, true),
                  value: `Prod ${m0(r.projectedTotalProduction)} · Income ${m0(r.currentIncome)} · Patient ${m0(r.currentPatientIncome)} · Ins ${r.currentIncome != null && r.currentPatientIncome != null ? m0(r.currentIncome - r.currentPatientIncome) : "—"}${r.notes ? ` · ${r.notes}` : ""}`,
                  onDelete: () => deleteWeeklyReview(r.id),
                })),
              }]}
              onChanged={async () => setLatestReview(await loadLatestWeeklyReview())}
            />
          </div>
        )}
      </div>

      {/* ---------- A/R — one row ---------- */}
      <div className={card}>
        <div className={hdr}>
          <h2 className="font-bold text-sm text-slate-700">A/R Aging</h2>
          <div className="flex items-center gap-3 text-xs">
            <UpdatedStamp when={latestArAging?.entryDate} />
            <HistoryButton open={openArHist} onClick={() => setOpenArHist((o) => !o)} />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-1.5">
          <Field label="0–30" width={82}><NumInput onFocus={(e) => e.target.select()} value={ar0to30} onChange={(e) => setAr0to30(e.target.value)} className={inp} /></Field>
          <Field label="31–60" width={82}><NumInput onFocus={(e) => e.target.select()} value={ar31to60} onChange={(e) => setAr31to60(e.target.value)} className={inp} /></Field>
          <Field label="61–90" width={82}><NumInput onFocus={(e) => e.target.select()} value={ar61to90} onChange={(e) => setAr61to90(e.target.value)} className={inp} /></Field>
          <Field label="90+" width={82}><NumInput onFocus={(e) => e.target.select()} value={ar90plus} onChange={(e) => setAr90plus(e.target.value)} className={inp} /></Field>
          <Field label="Total" title="The four buckets added up" width={88}><div className={`${calc} font-semibold`}>{arRaw > 0 ? m0(arRaw) : "—"}</div></Field>
          <Field label="W/O est." width={82}><NumInput onFocus={(e) => e.target.select()} value={arWoEstimate} onChange={(e) => setArWoEstimate(e.target.value)} className={inp} /></Field>
          <Field label="True A/R" title="Total less write-offs" width={88}><div className={`${calc} font-semibold`}>{arRaw > 0 ? m0(arTrue) : "—"}</div></Field>
          <Field label="Ins. est." width={82}><NumInput onFocus={(e) => e.target.select()} value={arInsuranceEstimate} onChange={(e) => setArInsuranceEstimate(e.target.value)} className={inp} /></Field>
          <Field label="Patient est." title="True A/R less insurance estimate" width={88}><div className={calc}>{arRaw > 0 ? m0(arPatient) : "—"}</div></Field>
          <div className="flex items-center gap-2 pb-0.5">
            <button onClick={handleSaveAr} className="rounded-lg px-3 py-1 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>Save</button>
            {arSaved && <span className="text-xs text-emerald-600 font-semibold">✓</span>}
          </div>
        </div>
        {arError && <p className="text-xs text-red-600 font-semibold mt-1">⚠️ {arError}</p>}

        {healthVisible && (
          <>
            <div className="mt-2 flex items-center gap-2 rounded-lg px-2.5 py-1 text-xs font-medium"
              style={{ background: hs.bg, color: hs.color, border: `1px solid ${hs.ring}` }}>
              <span className="whitespace-nowrap font-bold">{hs.icon} {hs.label}</span>
              <span className="truncate flex-1" title={health.reasons.join(" • ")}>
                True A/R {m0(health.totalAr)}
                {health.writeOffs > 0 && <> (less {m0(health.writeOffs)} W/O)</>}
                {" · "}{health.pctCurrent.toFixed(0)}% current · {health.pctOver60.toFixed(0)}% &gt;60d · {health.pctOver90.toFixed(0)}% &gt;90d
                {health.arRatio != null && health.daysInAr != null
                  ? <> · Ratio {health.arRatio.toFixed(2)} (~1.0) · {health.daysInAr.toFixed(0)} days (~45)</>
                  : <> · Ratio/days need Net Production logged on Trends</>}
              </span>
              {health.reasons.length > 0 && (
                <button onClick={() => setShowArWhy((s) => !s)} className="underline whitespace-nowrap">{showArWhy ? "hide" : "why?"}</button>
              )}
            </div>
            {showArWhy && health.reasons.length > 0 && (
              <ul className="text-xs mt-1 ml-2" style={{ color: hs.color }}>
                {health.reasons.map((r) => <li key={r}>• {r}</li>)}
              </ul>
            )}
          </>
        )}

        {openArHist && (
          <div className="mt-2">
            <HistoryBlock
              columns={[{
                title: "A/R entries",
                load: async () => (await loadArAgingHistory(60)).map((a): HistRow => {
                  const raw = a.ar0to30 + a.ar31to60 + a.ar61to90 + a.ar90plus;
                  return {
                    id: a.id, label: ymdLabel(a.entryDate, true),
                    value: `0–30 ${m0(a.ar0to30)} · 31–60 ${m0(a.ar31to60)} · 61–90 ${m0(a.ar61to90)} · 90+ ${m0(a.ar90plus)} · Total ${m0(raw)} · W/O ${m0(a.woEstimate)} · True ${m0(Math.max(0, raw - a.woEstimate))} · Ins ${m0(a.insuranceEstimate)}`,
                    onDelete: () => deleteArAgingEntry(a.id),
                  };
                }),
              }]}
              onChanged={async () => setLatestArAging(await loadLatestArAging())}
            />
          </div>
        )}
      </div>

      {/* ---------- Production goal — one line, detail on demand ---------- */}
      <div className={card}>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-bold text-sm text-slate-700 whitespace-nowrap">{goalYear} Goal</h2>
          <NumInput onFocus={(e) => e.target.select()} value={goalInput} onChange={(e) => setGoalInput(e.target.value)}
            placeholder="Annual" wrap="w-28" className="w-full rounded border border-slate-200 px-1.5 py-1 text-xs focus:outline-none" />
          <button onClick={handleSaveGoal} className="rounded-lg px-3 py-1 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>Save</button>
          {goalSaved && <span className="text-xs text-emerald-600 font-semibold">✓</span>}
          {goalProgress && goalProgress.annualGoal > 0 ? (
            <>
              <span className="text-xs text-slate-500 truncate flex-1" style={{ minWidth: 200 }}
                title={goalProgress.unreachable ? "The catch-up figure is above anything the practice has produced in a month this year — the goal may be worth revisiting." : undefined}>
                {m0(goalProgress.annualGoal / 12)}/mo even pace · Booked {m0(goalProgress.actualToDate)} of {m0(goalProgress.baselineToDate)}
                {" · "}
                <span className="font-semibold" style={{ color: goalProgress.onTrack ? "#3B6D11" : "#854F0B" }}>
                  {goalProgress.onTrack ? "Ahead" : "Behind"} {m0(Math.abs(goalProgress.shortfallToDate))}
                </span>
                {" · "}
                <span className="font-semibold" style={{ color: goalProgress.unreachable ? "#A32D2D" : "#185FA5" }}>
                  Need {m0(goalProgress.requiredPerRemainingMonth)}/mo × {goalProgress.remainingMonths}{goalProgress.unreachable ? " ⚠️" : ""}
                </span>
              </span>
              <button onClick={() => setShowGoalDetail((s) => !s)} className="text-xs text-orange-500 hover:underline whitespace-nowrap">{showGoalDetail ? "Hide months" : "Months"}</button>
            </>
          ) : (
            <span className="text-xs text-slate-400">Set an annual goal to track the year against it.</span>
          )}
        </div>
        {showGoalDetail && goalProgress && goalProgress.annualGoal > 0 && (
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] text-slate-400 border-b border-slate-100">
                  <th className="px-2 py-1 font-medium">Month</th>
                  <th className="px-2 py-1 font-medium">Target</th>
                  <th className="px-2 py-1 font-medium">Actual</th>
                  <th className="px-2 py-1 font-medium">vs even pace</th>
                </tr>
              </thead>
              <tbody>
                {goalProgress.rows.map((r) => (
                  <tr key={r.month} className="border-b border-slate-50 last:border-0" style={r.isCurrent ? { background: "#FDF6E4" } : undefined}>
                    <td className="px-2 py-0.5 whitespace-nowrap" style={{ color: r.isPast || r.isCurrent ? "#4A4238" : "rgba(74,66,56,0.45)" }}>
                      {new Date(`${goalYear}-${String(r.month).padStart(2, "0")}-02`).toLocaleDateString("en-US", { month: "short" })}
                      {r.isCurrent && <span className="text-slate-400"> · now</span>}
                    </td>
                    <td className="px-2 py-0.5 whitespace-nowrap" style={{ color: "rgba(74,66,56,0.6)" }}>{m0(r.adjustedTarget)}</td>
                    <td className="px-2 py-0.5 whitespace-nowrap font-medium">{r.actual != null ? m0(r.actual) : <span className="text-slate-300">—</span>}</td>
                    <td className="px-2 py-0.5 whitespace-nowrap font-semibold" style={{ color: r.variance == null ? "#cbd5e1" : r.variance >= 0 ? "#3B6D11" : "#A32D2D" }}>
                      {r.variance == null ? "—" : `${r.variance >= 0 ? "+" : "−"}${m0(Math.abs(r.variance))}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------- Debt — credit cards live only here ---------- */}
      {/* Debt — summary, every card and loan, and card warnings in one card */}
      <DebtPanel creditCards={cards} latestBalances={latestBalances} refreshAll={refreshAll} monthlyCollections={debtMonthlyCollections}
        cashAccounts={cashAccounts} charges={charges} allBills={allBills} allPayments={allPayments} />

      {/* Card charges — the recurring charges the near-limit warning is projected from */}
      <div>
        <h2 className="font-bold text-sm text-slate-700 mb-1">Card Charges</h2>
        <CardChargesPanel cards={cards} charges={charges} refreshAll={refreshAll} />
      </div>

      {/* Backfill — past statement balances and past net production */}
      <div className={card}>
        <h2 className="font-bold text-sm text-slate-700 mb-2">Backfill Past Months</h2>
        <BackfillPanel accounts={cashAccounts} cards={cards} loans={loans} refreshAll={refreshAll} />
      </div>
    </div>
  );
}
