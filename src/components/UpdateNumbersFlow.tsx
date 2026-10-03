"use client";

import { useState, useMemo } from "react";
import { formatMoney } from "@/lib/format";
import { Debt, saveDebt, saveDebtStatement } from "@/lib/debt";
import {
  CashAccount, CreditCard, BalanceCheck, WeeklyCashReview, ArAgingEntry,
  addBalanceCheck, updateBankStatementBalance, updateStatementBalance, saveWeeklyReview, saveArAgingEntry,
} from "@/lib/cashflow";
import { coveredMonth, previousMonth, monthLabel } from "@/lib/staleness";
import { MonthSelect, NumInput, fmtWhen } from "@/components/CashHistory";

/**
 * "Update Numbers Now" — one guided pass over every number the page tracks.
 *
 * Numbers that are due come first and are pre-selected; everything else is
 * listed unselected and unmarked, so the same flow serves "just what's due",
 * "everything", or "these few". Each step saves to the same place the Numbers
 * page does. The order of steps is fixed when the flow starts, so saving as
 * you go never reshuffles what's ahead.
 */

type StepKind = "bank" | "card" | "loan" | "od" | "ar";
interface Step { id: string; kind: StepKind; name: string; due: boolean; account?: CashAccount; card?: CreditCard; loan?: Debt }
type StmtEntry = { month: string; balance: number };

const KIND_LABEL: Record<StepKind, string> = { bank: "Bank account", card: "Credit card", loan: "Loan", od: "Open Dental", ar: "A/R" };

export default function UpdateNumbersFlow({
  open, onClose, onSaved, accounts, cards, loans, latestBalances, statements, review, ar, dueNames,
}: {
  open: boolean; onClose: () => void; onSaved: () => void;
  accounts: CashAccount[]; cards: CreditCard[]; loans: Debt[];
  latestBalances: Record<string, BalanceCheck>;
  statements: Record<string, StmtEntry[] | undefined>;
  review: WeeklyCashReview | null; ar: ArAgingEntry | null;
  dueNames: string[];
}) {
  const [phase, setPhase] = useState<"pick" | "run" | "summary">("pick");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<Record<string, "saved" | "skipped">>({});
  const [frozen, setFrozen] = useState<Step[] | null>(null);

  // Build the full step list; frozen when the flow starts so it doesn't reshuffle mid-pass.
  const live = useMemo<Step[]>(() => {
    const due = new Set(dueNames);
    return [
      ...accounts.map((a): Step => ({ id: `bank:${a.id}`, kind: "bank", name: a.name, due: due.has(a.name), account: a })),
      ...cards.map((c): Step => ({ id: `card:${c.id}`, kind: "card", name: c.name, due: due.has(c.name), card: c })),
      ...loans.map((l): Step => ({ id: `loan:${l.id}`, kind: "loan", name: l.name, due: due.has(l.name), loan: l })),
      { id: "od", kind: "od", name: "Open Dental numbers", due: due.has("Open Dental numbers") },
      { id: "ar", kind: "ar", name: "A/R aging", due: due.has("A/R aging") },
    ];
  }, [accounts, cards, loans, dueNames]);

  const steps = frozen ?? live;
  const byId = (id: string) => steps.find((s) => s.id === id)!;
  const dueSteps = steps.filter((s) => s.due);
  const otherSteps = steps.filter((s) => !s.due);

  // Reset to the picker whenever the flow is reopened.
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setPhase("pick"); setFrozen(null); setResults({}); setIdx(0); setQueue([]);
    setPicked(new Set(live.filter((s) => s.due).map((s) => s.id)));
  }
  if (!open && wasOpen) setWasOpen(false);
  if (!open) return null;

  function start(ids: string[]) {
    setFrozen(frozen ?? live);
    // Due numbers first, then the rest, each in list order.
    const ordered = [...(frozen ?? live).filter((s) => ids.includes(s.id) && s.due), ...(frozen ?? live).filter((s) => ids.includes(s.id) && !s.due)].map((s) => s.id);
    setQueue(ordered); setIdx(0); setPhase("run");
  }
  function advance(outcome: "saved" | "skipped") {
    const id = queue[idx];
    setResults((r) => ({ ...r, [id]: outcome }));
    if (idx + 1 >= queue.length) setPhase("summary"); else setIdx(idx + 1);
  }

  const savedCount = Object.values(results).filter((r) => r === "saved").length;
  const skippedCount = Object.values(results).filter((r) => r === "skipped").length;
  const remaining = steps.filter((s) => !queue.includes(s.id));

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const row = (s: Step) => (
    <label key={s.id} className="flex items-center gap-3 py-1.5 border-t border-slate-100 text-sm cursor-pointer">
      <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} className="h-4 w-4" />
      <span className="font-medium text-slate-800 flex-1 min-w-0 truncate">{s.name}</span>
      <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{KIND_LABEL[s.kind]}</span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: "rgba(15,23,42,0.45)" }}>
      <div className="w-full bg-white rounded-2xl shadow-xl p-5 my-6" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label="Update numbers">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="font-bold text-slate-800" style={{ fontSize: 18 }}>Update Numbers</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none" aria-label="Close">✕</button>
        </div>

        {phase === "pick" && (
          <>
            <p className="text-sm text-slate-500 mb-3">
              {dueSteps.length > 0 ? `${dueSteps.length} ${dueSteps.length === 1 ? "number is" : "numbers are"} due and already selected.` : "Nothing is due right now."} Tick anything else you'd like to update too.
            </p>
            <div className="flex flex-wrap gap-2 mb-3">
              <button onClick={() => setPicked(new Set(dueSteps.map((s) => s.id)))} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600">Due only</button>
              <button onClick={() => setPicked(new Set(steps.map((s) => s.id)))} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600">Select all</button>
              <button onClick={() => setPicked(new Set())} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600">Clear</button>
            </div>
            {dueSteps.length > 0 && (
              <div className="mb-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">Due now</p>
                {dueSteps.map(row)}
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">{dueSteps.length > 0 ? "Everything else" : "All numbers"}</p>
              {otherSteps.map(row)}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:underline">Cancel</button>
              <button disabled={picked.size === 0} onClick={() => start([...picked])}
                className="rounded-lg px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40" style={{ backgroundColor: "#e8622a" }}>
                Start ({picked.size})
              </button>
            </div>
          </>
        )}

        {phase === "run" && queue[idx] && (
          <StepForm key={queue[idx]} step={byId(queue[idx])} position={idx + 1} total={queue.length}
            latestBalances={latestBalances} statements={statements} review={review} ar={ar}
            canBack={idx > 0} onBack={() => setIdx(idx - 1)}
            onSkip={() => advance("skipped")}
            onSaved={() => { onSaved(); advance("saved"); }} />
        )}

        {phase === "summary" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <strong>{savedCount}</strong> saved{skippedCount > 0 ? <>, <strong>{skippedCount}</strong> skipped</> : ""}.
            </p>
            {remaining.length > 0 && (
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-sm text-slate-600 mb-2">{remaining.length} other {remaining.length === 1 ? "number wasn't" : "numbers weren't"} in this pass. Update {remaining.length === 1 ? "it" : "them"} too?</p>
                <button onClick={() => { setIdx(0); setQueue(remaining.map((s) => s.id)); setPhase("run"); }}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>Continue with the others</button>
              </div>
            )}
            <div className="flex justify-end"><button onClick={onClose} className="rounded-lg px-5 py-2 text-sm font-semibold text-slate-700 border border-slate-300 hover:bg-slate-50">Done</button></div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- One step ----------------

function StepForm({ step, position, total, latestBalances, statements, review, ar, canBack, onBack, onSkip, onSaved }: {
  step: Step; position: number; total: number;
  latestBalances: Record<string, BalanceCheck>; statements: Record<string, StmtEntry[] | undefined>;
  review: WeeklyCashReview | null; ar: ArAgingEntry | null;
  canBack: boolean; onBack: () => void; onSkip: () => void; onSaved: () => void;
}) {
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAccount = step.kind === "bank" || step.kind === "card" || step.kind === "loan";
  const entityId = step.account?.id ?? step.card?.id ?? step.loan?.id ?? "";
  const hist = statements[entityId] ?? [];
  const defaultMonth = step.kind === "card" ? coveredMonth(step.card!.approxClosingDay) : previousMonth();
  const lastBal = latestBalances[step.name];
  const fallbackBal = step.loan?.currentBalance;

  const [cur, setCur] = useState(isAccount ? String(lastBal?.balance ?? fallbackBal ?? "") : "");
  const [month, setMonth] = useState(defaultMonth);
  const [stmt, setStmt] = useState(() => { const e = hist.find((h) => h.month === defaultMonth); return e ? String(e.balance) : ""; });

  const [prod, setProd] = useState(review?.projectedTotalProduction != null ? String(review.projectedTotalProduction) : "");
  const [income, setIncome] = useState(review?.currentIncome != null ? String(review.currentIncome) : "");
  const [patient, setPatient] = useState(review?.currentPatientIncome != null ? String(review.currentPatientIncome) : "");
  const [notes, setNotes] = useState(review?.notes ?? "");

  const [a0, setA0] = useState(ar ? String(ar.ar0to30) : "");
  const [a31, setA31] = useState(ar ? String(ar.ar31to60) : "");
  const [a61, setA61] = useState(ar ? String(ar.ar61to90) : "");
  const [a90, setA90] = useState(ar ? String(ar.ar90plus) : "");
  const [wo, setWo] = useState(ar ? String(ar.woEstimate) : "");
  const [ins, setIns] = useState(ar ? String(ar.insuranceEstimate) : "");

  const n = (s: string) => (s ? Number(s) : 0);
  const num = (s: string) => (s !== "" && !isNaN(Number(s)) ? Number(s) : null);
  const arRaw = n(a0) + n(a31) + n(a61) + n(a90);
  const arTrue = Math.max(0, arRaw - n(wo));

  const pickMonth = (m: string) => { setMonth(m); const e = hist.find((h) => h.month === m); setStmt(e ? String(e.balance) : ""); };

  async function save() {
    setSaving(true); setError(null);
    const fails: string[] = [];
    try {
      if (isAccount) {
        const c = num(cur);
        if (c != null) {
          const r = await addBalanceCheck(step.name, c);
          if (!r.ok) fails.push(`balance (${r.error ?? "failed"})`);
          if (step.loan) {
            const r2 = await saveDebt({ ...step.loan, currentBalance: c });
            if (!r2.ok) fails.push(`loan record (${r2.error ?? "failed"})`);
          }
        }
        const sv = num(stmt);
        const existing = hist.find((h) => h.month === month);
        if (sv != null && (!existing || existing.balance !== sv)) {
          const r = step.account ? await updateBankStatementBalance(step.account.id, sv, month)
            : step.card ? await updateStatementBalance(step.card.id, sv, month)
            : await saveDebtStatement(step.loan!.id, month, sv);
          if (!r.ok) fails.push(`statement (${r.error ?? "failed"})`);
        }
      } else if (step.kind === "od") {
        const r = await saveWeeklyReview({
          reviewDate: today, projectedTotalProduction: num(prod), currentIncome: num(income), currentPatientIncome: num(patient), notes,
        });
        if (!r.ok) fails.push(r.error ?? "Open Dental numbers");
      } else {
        const r = await saveArAgingEntry({
          entryDate: today, ar0to30: n(a0), ar31to60: n(a31), ar61to90: n(a61), ar90plus: n(a90), woEstimate: n(wo), insuranceEstimate: n(ins),
        });
        if (!r.ok) fails.push(r.error ?? "A/R aging");
      }
    } catch (e) {
      fails.push(e instanceof Error ? e.message : "unexpected error");
    }
    setSaving(false);
    if (fails.length > 0) { setError(`Couldn't save: ${fails.join("; ")}`); return; }
    onSaved();
  }

  const box = "w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm focus:outline-none";
  const lbl = "block text-xs font-semibold text-slate-600 mb-1";
  const lastLine = isAccount
    ? (lastBal ? `Last balance $${formatMoney(lastBal.balance)} · ${fmtWhen(lastBal.checkedAt)}` : "No balance entered yet")
    : step.kind === "od" ? (review ? `Last entered ${fmtWhen(review.reviewDate)}` : "Never entered")
    : (ar ? `Last entered ${fmtWhen(ar.entryDate)}` : "Never entered");

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full" style={{ width: `${(position / total) * 100}%`, background: "#e8622a" }} /></div>
        <span className="text-xs text-slate-500 whitespace-nowrap">Step {position} of {total}</span>
      </div>

      <div className="flex items-center gap-2 mt-3">
        <h3 className="font-bold text-slate-800" style={{ fontSize: 17 }}>{step.name}</h3>
        <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{KIND_LABEL[step.kind]}</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">{lastLine}</p>

      {isAccount && (
        <div className="space-y-3">
          <div>
            <label className={lbl}>Current balance</label>
            <NumInput autoFocus onFocus={(e) => e.target.select()} value={cur} onChange={(e) => setCur(e.target.value)} className={box} />
          </div>
          <div>
            <label className={lbl}>Statement balance</label>
            <div className="flex items-center gap-2">
              <MonthSelect value={month} onChange={pickMonth} className="!py-2 !px-2 !text-sm" />
              <NumInput onFocus={(e) => e.target.select()} value={stmt} onChange={(e) => setStmt(e.target.value)} placeholder={`${monthLabel(month)} statement`} className={box} />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Leave blank to skip the statement — it's saved against the month it covers.</p>
          </div>
        </div>
      )}

      {step.kind === "od" && (
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Projected production</label><NumInput autoFocus onFocus={(e) => e.target.select()} value={prod} onChange={(e) => setProd(e.target.value)} className={box} /></div>
          <div><label className={lbl}>Income to date</label><NumInput onFocus={(e) => e.target.select()} value={income} onChange={(e) => setIncome(e.target.value)} className={box} /></div>
          <div><label className={lbl}>Patient income</label><NumInput onFocus={(e) => e.target.select()} value={patient} onChange={(e) => setPatient(e.target.value)} className={box} /></div>
          <div><label className={lbl}>Insurance (calculated)</label><div className={`${box} bg-slate-50 text-slate-600`}>{num(income) != null && num(patient) != null ? `$${formatMoney(num(income)! - num(patient)!)}` : "—"}</div></div>
          <div className="col-span-2"><label className={lbl}>Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} className={box} /></div>
        </div>
      )}

      {step.kind === "ar" && (
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>0–30 days</label><NumInput autoFocus onFocus={(e) => e.target.select()} value={a0} onChange={(e) => setA0(e.target.value)} className={box} /></div>
          <div><label className={lbl}>31–60 days</label><NumInput onFocus={(e) => e.target.select()} value={a31} onChange={(e) => setA31(e.target.value)} className={box} /></div>
          <div><label className={lbl}>61–90 days</label><NumInput onFocus={(e) => e.target.select()} value={a61} onChange={(e) => setA61(e.target.value)} className={box} /></div>
          <div><label className={lbl}>90+ days</label><NumInput onFocus={(e) => e.target.select()} value={a90} onChange={(e) => setA90(e.target.value)} className={box} /></div>
          <div><label className={lbl}>Write-off estimate</label><NumInput onFocus={(e) => e.target.select()} value={wo} onChange={(e) => setWo(e.target.value)} className={box} /></div>
          <div><label className={lbl}>Insurance estimate</label><NumInput onFocus={(e) => e.target.select()} value={ins} onChange={(e) => setIns(e.target.value)} className={box} /></div>
          <div className="col-span-2 flex justify-between text-sm text-slate-600 rounded-lg bg-slate-50 px-3 py-2">
            <span>Total <strong className="text-slate-800">${formatMoney(arRaw)}</strong></span>
            <span>True A/R <strong className="text-slate-800">${formatMoney(arTrue)}</strong></span>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600 font-semibold mt-3">⚠️ {error}</p>}

      <div className="flex items-center justify-between gap-2 mt-5">
        <button onClick={onBack} disabled={!canBack || saving} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:underline disabled:opacity-30">← Back</button>
        <div className="flex items-center gap-2">
          <button onClick={onSkip} disabled={saving} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">Skip</button>
          <button onClick={save} disabled={saving} className="rounded-lg px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "#e8622a" }}>
            {saving ? "Saving…" : position === total ? "Save & finish" : "Save & next"}
          </button>
        </div>
      </div>
    </div>
  );
}
