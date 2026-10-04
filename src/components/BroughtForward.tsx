"use client";

import { useState, useEffect } from "react";
import { CarryProgramme, loadBonusCarryovers, saveBonusCarryover, carryKey } from "@/lib/bonusCarryover";

/**
 * "Balance brought forward": one dollar amount for what is still owed from
 * before this year. Type it once and it's added to what's owed; payments made
 * through payroll reduce it from there. Cash Flow's "Need to collect" uses it
 * too. employeeId is 0 for the staff growth bonus.
 */
export default function BroughtForward({ programme, employeeId, onSaved }: { programme: CarryProgramme; employeeId: number; onSaved?: () => void }) {
  const thisYear = new Date().getFullYear();
  const [value, setValue] = useState("");
  const [fromYear, setFromYear] = useState<number>(thisYear);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadBonusCarryovers().then((m) => {
      const c = m.get(carryKey(programme, employeeId));
      setValue(c ? String(c.amount) : "");
      setFromYear(c?.asOfYear ?? thisYear);
    });
  }, [programme, employeeId, thisYear]);

  async function save() {
    const amount = value === "" ? 0 : Number(value);
    if (isNaN(amount)) { setError("Enter a dollar amount."); return; }
    setError(null);
    if (!fromYear || fromYear < 2000) { setError("Enter the year."); return; }
    const r = await saveBonusCarryover({ programme, employeeId, amount, asOfYear: fromYear });
    if (!r.ok) { setError(r.error ?? "Couldn't save."); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    onSaved?.();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
      <label className="text-sm font-semibold text-amber-900">Balance brought forward</label>
      <span className="relative inline-block" style={{ width: 130 }}>
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">$</span>
        <input type="number" onFocus={(e) => e.target.select()} value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00"
          className="w-full rounded border border-amber-300 bg-white py-1 text-sm focus:outline-none" style={{ paddingLeft: 18 }} />
      </span>
      <button onClick={save} className="rounded-lg px-3 py-1 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>Save</button>
      {saved && <span className="text-xs text-emerald-600 font-semibold">✓ Saved</span>}
      <span className="text-xs text-amber-800">owed at the start of</span>
      <input type="number" value={fromYear} onChange={(e) => setFromYear(Number(e.target.value))}
        className="rounded border border-amber-300 bg-white py-1 px-1.5 text-sm focus:outline-none" style={{ width: 70 }} />
      <span className="text-xs text-amber-800">
        {fromYear < thisYear ? `Everything from ${fromYear} on is calculated on top of it.` : "Added to what's owed; payments reduce it."}
      </span>
      {error && <span className="text-xs text-red-600 font-semibold">⚠️ {error}</span>}
    </div>
  );
}
