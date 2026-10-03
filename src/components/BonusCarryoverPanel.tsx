"use client";

import { useState, useEffect } from "react";
import { loadStaff } from "@/lib/staffStore";
import { Employee } from "@/types/employee";
import { CarryProgramme, BonusCarryover, loadBonusCarryovers, saveBonusCarryover, carryKey } from "@/lib/bonusCarryover";
import { NumInput } from "@/components/CashHistory";

/**
 * Unpaid bonus balances carried in from earlier years — just a dollar figure,
 * no calculation. From the start of the year given, the app works everything
 * out itself from the bonus sheets and payroll.
 */

interface Row { key: string; programme: CarryProgramme; employeeId: number; label: string; hint: string }

export default function BonusCarryoverPanel({ refreshAll }: { refreshAll: () => void }) {
  const thisYear = new Date().getFullYear();
  const [rows, setRows] = useState<Row[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [years, setYears] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [staff, carry] = await Promise.all([loadStaff(), loadBonusCarryovers()]);
      const active = staff.filter((s: Employee) => !s.archived);
      const list: Row[] = [];
      for (const e of active.filter((s) => s.role === "Hygienist" || (s.skills ?? []).includes("Hygienist")))
        list.push({ key: carryKey("hygiene", e.id), programme: "hygiene", employeeId: e.id, label: `${e.name} — hygiene bonus`, hint: "Unpaid hygiene bonus from earlier years" });
      if (active.some((s) => s.growthBonusEligible))
        list.push({ key: carryKey("growth", 0), programme: "growth", employeeId: 0, label: "Staff growth bonus", hint: "Unpaid growth bonus from earlier years" });
      for (const e of active.filter((s) => s.pvBonusEligible))
        list.push({ key: carryKey("pv", e.id), programme: "pv", employeeId: e.id, label: `${e.name} — net production bonus`, hint: "Unpaid net production bonus from earlier quarters" });
      setRows(list);
      const a: Record<string, string> = {}, y: Record<string, string> = {};
      list.forEach((r) => { const c = carry.get(r.key); a[r.key] = c ? String(c.amount) : ""; y[r.key] = String(c?.asOfYear ?? thisYear); });
      setAmounts(a); setYears(y);
    })();
  }, [thisYear]);

  async function save(r: Row) {
    const amount = Number(amounts[r.key] === "" ? 0 : amounts[r.key]);
    const asOfYear = Number(years[r.key]);
    if (isNaN(amount) || !asOfYear) { setError("Enter a dollar amount and a year."); return; }
    setError(null);
    const c: BonusCarryover = { programme: r.programme, employeeId: r.employeeId, amount, asOfYear };
    const res = await saveBonusCarryover(c);
    if (!res.ok) { setError(res.error ?? "Couldn't save."); return; }
    setSaved((s) => ({ ...s, [r.key]: true }));
    setTimeout(() => setSaved((s) => ({ ...s, [r.key]: false })), 2500);
    refreshAll();
  }

  const box = "rounded border border-slate-200 px-1.5 py-1 text-xs focus:outline-none";

  if (rows.length === 0) return <p className="text-xs text-slate-400">No hygienists or bonus-eligible staff found on the Staff page.</p>;

  return (
    <div>
      <p className="text-xs text-slate-500 mb-2">
        Type what was still unpaid at the start of the year shown. From that year on, the app calculates everything from the bonus sheets and payroll. Dr. Ho doesn't need one.
      </p>
      {error && <p className="text-xs text-red-600 font-semibold mb-1">⚠️ {error}</p>}
      <div className="overflow-x-auto">
        <div style={{ minWidth: 560 }}>
          <div className="grid gap-x-2 text-[11px] text-slate-400 font-medium border-b border-slate-100 pb-1" style={{ gridTemplateColumns: "minmax(200px,1.6fr) 120px 90px 70px" }}>
            <span>Bonus</span><span>Unpaid balance</span><span>At start of</span><span />
          </div>
          {rows.map((r) => (
            <div key={r.key} className="grid items-center gap-x-2 py-1.5 border-b border-slate-50 last:border-0 text-xs" style={{ gridTemplateColumns: "minmax(200px,1.6fr) 120px 90px 70px" }}>
              <span className="truncate text-slate-700 font-medium" title={r.hint}>{r.label}</span>
              <NumInput onFocus={(e) => e.target.select()} value={amounts[r.key] ?? ""} onChange={(e) => setAmounts((s) => ({ ...s, [r.key]: e.target.value }))} placeholder="0.00" className={`${box} w-full`} />
              <input type="number" value={years[r.key] ?? ""} onChange={(e) => setYears((s) => ({ ...s, [r.key]: e.target.value }))} className={`${box} w-full`} />
              <span className="text-right whitespace-nowrap">
                <button onClick={() => save(r)} className="rounded-lg px-3 py-1 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>Save</button>
                {saved[r.key] && <span className="text-emerald-600 font-semibold ml-1">✓</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
