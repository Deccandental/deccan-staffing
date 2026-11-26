"use client";

import { useEffect, useState } from "react";
import { sessionHeaders } from "@/lib/secureData";
import { requestOdSync } from "@/lib/openDental/clientSync";

// "Charge assistant" card for a day in the Schedule Builder. The app rotates
// the charge fairly (see lib/charge.ts); an admin can swap in someone else.

interface Person { employeeId: number; name: string; shownAs: string; lastTurn: string | null; turns90: number }
interface DayCharge { ok: boolean; error?: string; editable: boolean; current: (Person & { manual: boolean }) | null; candidates: Person[] }

const fmt = (ymd: string | null) => (ymd ? new Date(ymd + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "never");

async function call(body: Record<string, unknown>): Promise<DayCharge> {
  try {
    const res = await fetch("/api/charge", { method: "POST", headers: sessionHeaders(), body: JSON.stringify(body) });
    return await res.json();
  } catch {
    return { ok: false, error: "Network error." } as DayCharge;
  }
}

export default function ChargePanel({ date, refreshKey, canEdit, onChanged }: { date: string; refreshKey: string; canEdit: boolean; onChanged?: () => void }) {
  const [info, setInfo] = useState<DayCharge | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setSwapping(false); call({ action: "day", date }).then(setInfo); }, [date]);
  useEffect(() => {
    // The plan changed: the charge may have moved, here and on the calendar.
    const t = setTimeout(() => call({ action: "day", date }).then((d) => { setInfo(d); onChanged?.(); }), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  async function set(employeeId: number | null) {
    setBusy(true);
    const d = await call({ action: "set", date, employeeId });
    setBusy(false);
    setSwapping(false);
    if (!d.ok) { alert(d.error ?? "Couldn't change it."); return; }
    setInfo(d);
    requestOdSync(date);
    onChanged?.();
  }

  if (!info) return null;
  if (!info.ok) return <section className="rounded-2xl bg-white p-6 shadow text-sm text-red-500">{info.error}</section>;
  if (info.candidates.length === 0) return null;

  return (
    <section className="rounded-2xl bg-white p-6 shadow">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="card-title">⭐ Charge assistant</h3>
        {info.current?.manual && <span className="text-xs text-cyan-500">picked by hand</span>}
      </div>
      <p className="text-xs text-slate-400 mb-3">Takes turns among the assistants in that day: whoever has gone longest goes next, and nobody twice in a row unless they're the only one in.</p>

      {swapping ? (
        <div className="space-y-1">
          {info.candidates.map((p) => (
            <button key={p.employeeId} disabled={busy} onClick={() => set(p.employeeId)}
              className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-sm text-left hover:bg-slate-50 ${info.current?.employeeId === p.employeeId ? "border-amber-300 bg-amber-50" : "border-slate-200"}`}>
              <span className="font-medium text-slate-700">{p.name}</span>
              <span className="text-xs text-slate-400">last turn {fmt(p.lastTurn)} · {p.turns90} in 90 days</span>
            </button>
          ))}
          <div className="flex gap-3 pt-1">
            {info.current?.manual && <button disabled={busy} onClick={() => set(null)} className="text-xs font-semibold text-slate-500 hover:underline">Back to automatic</button>}
            <button onClick={() => setSwapping(false)} className="text-xs text-slate-400 hover:underline">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
          <span className="text-sm font-semibold text-amber-800">{info.current ? info.current.name : "Not decided yet"}</span>
          {canEdit && info.editable && (
            <button onClick={() => setSwapping(true)} className="rounded px-1.5 py-0.5 text-xs text-amber-600 hover:bg-amber-100">swap</button>
          )}
        </div>
      )}
    </section>
  );
}
