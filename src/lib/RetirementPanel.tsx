"use client";

import { useState, useEffect, useCallback } from "react";
import { Employee } from "@/types/employee";
import { loadStaff } from "@/lib/staffStore";
import { formatMoney } from "@/lib/format";
import { getPayPeriodsInYear, formatPayDate } from "@/lib/hygieneBonus";
import {
  RetirementDeposit, loadRetirementAccruals, saveRetirementAccrual,
  loadRetirementDeposits, addRetirementDeposit, deleteRetirementDeposit,
} from "@/lib/retirement";
import { BonusCarryover, loadBonusCarryovers, carryKey } from "@/lib/bonusCarryover";
import BroughtForward from "@/components/BroughtForward";
import NumCell from "@/components/NumCell";
import { NumInput } from "@/components/CashHistory";

/**
 * 401k money owed to the plan, per person: each pay period's employee deferral
 * and employer match (typed in from payroll), against dated deposits into the
 * plan. A deposit often covers several pay periods at once, so deposits are a
 * separate list rather than a column. What's left is what is still owed, and
 * Cash Flow's "Need to collect" includes it.
 */

const entry = "rounded border border-sky-300 bg-sky-50 px-1.5 py-1 text-xs font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-300 focus:border-orange-400 focus:bg-white focus:outline-none";

export default function RetirementPanel() {
  const thisYear = new Date().getFullYear();
  const [staff, setStaff] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [year, setYear] = useState(thisYear);
  const [rows, setRows] = useState<Record<string, { deferral: number; match: number }>>({});
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [deposits, setDeposits] = useState<RetirementDeposit[]>([]);
  const [carry, setCarry] = useState<BonusCarryover | null>(null);
  const [priorAccrued, setPriorAccrued] = useState(0);
  const [priorDeposited, setPriorDeposited] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [depDate, setDepDate] = useState(new Date().toISOString().slice(0, 10));
  const [depAmount, setDepAmount] = useState("");
  const [depNote, setDepNote] = useState("");
  const [depError, setDepError] = useState("");

  useEffect(() => {
    loadStaff().then((s) => {
      const list = s.filter((e) => !e.archived).sort((a, b) => a.name.localeCompare(b.name));
      setStaff(list);
      setEmployeeId((cur) => cur ?? list[0]?.id ?? null);
    });
  }, []);

  const periods = getPayPeriodsInYear(year);

  const refresh = useCallback(async () => {
    if (employeeId == null) return;
    setLoading(true);
    const [acc, deps, carryMap] = await Promise.all([
      loadRetirementAccruals(employeeId, `${year - 4}-01-01`, `${year}-12-31`),
      loadRetirementDeposits(employeeId),
      loadBonusCarryovers(),
    ]);
    const map: Record<string, { deferral: number; match: number }> = {};
    const have = new Set<string>();
    for (const a of acc) if (a.payPeriodStart >= `${year}-01-01`) { map[a.payPeriodStart] = { deferral: a.deferral, match: a.match }; have.add(a.payPeriodStart); }
    setRows(map); setExisting(have); setDeposits(deps);
    // Balance at the start of this year: what was brought forward, plus every earlier year
    // since then, so the year's balance is the real total owed.
    const c = carryMap.get(carryKey("retirement", employeeId)) ?? null;
    setCarry(c);
    if (c && year > c.asOfYear) {
      const from = `${c.asOfYear}-01-01`, to = `${year - 1}-12-31`;
      setPriorAccrued(acc.filter((a) => a.payPeriodStart >= from && a.payPeriodStart <= to).reduce((s, a) => s + a.deferral + a.match, 0));
      setPriorDeposited(deps.filter((d) => d.datePaid >= from && d.datePaid <= to).reduce((s, d) => s + d.amount, 0));
    } else { setPriorAccrued(0); setPriorDeposited(0); }
    setLoading(false);
  }, [employeeId, year]);
  useEffect(() => { refresh(); }, [refresh]);

  const startBalance = carry && year >= carry.asOfYear ? carry.amount + priorAccrued - priorDeposited : 0;
  const setCell = (start: string, field: "deferral" | "match", n: number) =>
    setRows((r) => ({ ...r, [start]: { deferral: r[start]?.deferral ?? 0, match: r[start]?.match ?? 0, [field]: n } }));

  const owedThisYear = periods.reduce((s, p) => s + (rows[p.start]?.deferral ?? 0) + (rows[p.start]?.match ?? 0), 0);
  const deferralTotal = periods.reduce((s, p) => s + (rows[p.start]?.deferral ?? 0), 0);
  const matchTotal = periods.reduce((s, p) => s + (rows[p.start]?.match ?? 0), 0);
  const yearDeposits = deposits.filter((d) => d.datePaid >= `${year}-01-01` && d.datePaid <= `${year}-12-31`);
  const depositedThisYear = yearDeposits.reduce((s, d) => s + d.amount, 0);
  const stillOwed = startBalance + owedThisYear - depositedThisYear;
  const person = staff.find((e) => e.id === employeeId);

  async function handleSaveAll() {
    if (employeeId == null) return;
    setSaving(true);
    const jobs = periods.filter((p) => {
      const r = rows[p.start];
      return existing.has(p.start) || (r && (r.deferral !== 0 || r.match !== 0));
    }).map((p) => saveRetirementAccrual({ employeeId, payPeriodStart: p.start, deferral: rows[p.start]?.deferral ?? 0, match: rows[p.start]?.match ?? 0 }));
    const results = await Promise.all(jobs);
    setSaving(false);
    const bad = results.find((r) => !r.ok);
    setSavedMsg(bad ? `Not saved: ${bad.error ?? "error"}` : "Saved.");
    setTimeout(() => setSavedMsg(""), 3000);
    if (!bad) refresh();
  }

  async function handleAddDeposit() {
    if (employeeId == null) return;
    const amount = Number(depAmount);
    if (!depDate || !amount || amount <= 0) { setDepError("Enter a date and an amount."); return; }
    setDepError("");
    const r = await addRetirementDeposit({ employeeId, datePaid: depDate, amount, note: depNote.trim() });
    if (!r.ok) { setDepError(r.error ?? "Couldn't save."); return; }
    setDepAmount(""); setDepNote("");
    refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        401k owed to the plan. Type each pay period's employee deferral and employer match from payroll, and log deposits as you make them. A deposit can cover several periods.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select value={employeeId ?? ""} onChange={(e) => setEmployeeId(e.target.value ? Number(e.target.value) : null)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none">
          {staff.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none" style={{ width: 90 }} />
      </div>

      {employeeId != null && <BroughtForward programme="retirement" employeeId={employeeId} onSaved={refresh} />}

      {employeeId == null ? <p className="text-sm text-slate-400">No staff found.</p> : loading ? <p className="text-slate-400 text-sm">Loading…</p> : (
        <>
          <div className="rounded-xl px-4 py-3 text-sm" style={{ background: stillOwed > 0.005 ? "#FAEEDA" : stillOwed < -0.005 ? "#FCEBEB" : "#f1f5f9" }}>
            {stillOwed > 0.005 ? (
              <span style={{ color: "#854F0B" }}>Still owed to the plan for {person?.name ?? "this person"}: <strong>${formatMoney(stillOwed)}</strong>
                {startBalance !== 0 && <> (${formatMoney(startBalance)} brought forward + ${formatMoney(owedThisYear)} owed in {year} &minus; ${formatMoney(depositedThisYear)} deposited)</>}
                {startBalance === 0 && <> (${formatMoney(owedThisYear)} owed in {year} &minus; ${formatMoney(depositedThisYear)} deposited)</>}</span>
            ) : stillOwed < -0.005 ? (
              <span style={{ color: "#A32D2D" }}>Deposited ahead by <strong>${formatMoney(-stillOwed)}</strong>.</span>
            ) : (
              <span className="text-slate-600">Nothing owed to the plan.</span>
            )}
          </div>

          <div className="rounded-xl bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                    <th className="px-3 py-2 font-medium">Pay Period</th>
                    <th className="px-2 py-2 font-medium">Pay Date</th>
                    <th className="px-2 py-2 font-medium">Employee deferral</th>
                    <th className="px-2 py-2 font-medium">Employer match</th>
                    <th className="px-2 py-2 font-medium">Total owed</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p) => {
                    const r = rows[p.start] ?? { deferral: 0, match: 0 };
                    return (
                      <tr key={p.start} className="border-b border-slate-50 last:border-0">
                        <td className="px-3 py-1 font-medium text-slate-700 whitespace-nowrap">{p.label}</td>
                        <td className="px-2 py-1 text-slate-500 whitespace-nowrap">{formatPayDate(p.payDate)}</td>
                        <td className="px-2 py-1"><NumCell value={r.deferral} onChange={(n) => setCell(p.start, "deferral", n)} className={`${entry} w-24`} /></td>
                        <td className="px-2 py-1"><NumCell value={r.match} onChange={(n) => setCell(p.start, "match", n)} className={`${entry} w-24`} /></td>
                        <td className="px-2 py-1 text-slate-600 whitespace-nowrap">${formatMoney(r.deferral + r.match)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="text-slate-700 font-semibold border-t-2 border-slate-200">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-2 py-2" />
                    <td className="px-2 py-2">${formatMoney(deferralTotal)}</td>
                    <td className="px-2 py-2">${formatMoney(matchTotal)}</td>
                    <td className="px-2 py-2">${formatMoney(owedThisYear)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex items-center gap-3 p-3 border-t border-slate-100">
              <button onClick={handleSaveAll} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "#e8622a" }}>
                {saving ? "Saving…" : "Save All"}
              </button>
              {savedMsg && <span className="text-sm text-slate-500">{savedMsg}</span>}
            </div>
          </div>

          <div className="rounded-xl bg-white shadow-sm p-4 space-y-2">
            <h3 className="font-bold text-sm text-slate-700">Deposits into the plan</h3>
            <div className="flex flex-wrap items-end gap-2">
              <div><label className="block text-xs text-slate-500 mb-1">Date</label>
                <input type="date" value={depDate} onChange={(e) => setDepDate(e.target.value)} className={`${entry} !text-sm !py-1.5`} /></div>
              <div><label className="block text-xs text-slate-500 mb-1">Amount</label>
                <NumInput onFocus={(e) => e.target.select()} value={depAmount} onChange={(e) => setDepAmount(e.target.value)} wrap="w-32" className={`${entry} w-full !text-sm !py-1.5`} /></div>
              <div style={{ flex: "1 1 160px" }}><label className="block text-xs text-slate-500 mb-1">Note (optional)</label>
                <input value={depNote} onChange={(e) => setDepNote(e.target.value)} className={`${entry} w-full !text-sm !py-1.5`} /></div>
              <button onClick={handleAddDeposit} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>+ Add deposit</button>
            </div>
            {depError && <p className="text-xs text-red-600 font-semibold">⚠️ {depError}</p>}
            {yearDeposits.length === 0 ? <p className="text-xs text-slate-400">No deposits logged for {year}.</p> : (
              <div className="pt-1">
                {yearDeposits.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 text-sm py-1 border-t border-slate-100 first:border-0">
                    <span className="text-slate-500 w-24">{new Date(d.datePaid + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                    <span className="font-semibold text-slate-700 w-28">${formatMoney(d.amount)}</span>
                    <span className="text-slate-400 flex-1 truncate">{d.note}</span>
                    <button title="Delete this deposit" onClick={async () => { if (!confirm("Delete this deposit? This can't be undone.")) return; await deleteRetirementDeposit(d.id); refresh(); }} className="text-red-400 hover:text-red-600">✕</button>
                  </div>
                ))}
                <div className="flex items-center gap-3 text-sm pt-2 mt-1 border-t-2 border-slate-200 font-semibold text-slate-700">
                  <span className="w-24">Total</span><span className="w-28">${formatMoney(depositedThisYear)}</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
