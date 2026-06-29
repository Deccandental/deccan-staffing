"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Holiday, loadHolidays, addHoliday, removeHoliday } from "@/lib/holidays";
import { generateMonth, formatMonthYear } from "@/utils/calendar";

const PASSCODE = "2503";

const TYPE_STYLES: Record<string, string> = {
  holiday: "bg-red-100 text-red-700",
  closure: "bg-orange-100 text-orange-700",
  other: "bg-slate-100 text-slate-600",
};

const TYPE_LABELS: Record<string, string> = {
  holiday: "Public Holiday",
  closure: "Office Closure",
  other: "Other",
};

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function HolidaysPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [passcodeError, setPasscodeError] = useState(false);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [form, setForm] = useState({ date: "", name: "", type: "holiday" as Holiday["type"] });
  const [error, setError] = useState("");
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  useEffect(() => { if (authenticated) refresh(); }, [authenticated]);

  function refresh() {
    setHolidays(loadHolidays().sort((a, b) => a.date.localeCompare(b.date)));
  }

  function handlePasscode() {
    if (passcode === PASSCODE) { setAuthenticated(true); setPasscodeError(false); }
    else { setPasscodeError(true); setPasscode(""); }
  }

  function handleAdd() {
    setError("");
    if (!form.date) { setError("Please select a date."); return; }
    if (!form.name.trim()) { setError("Please enter a name."); return; }
    addHoliday({ date: form.date, name: form.name.trim(), type: form.type });
    setForm({ date: "", name: "", type: "holiday" });
    refresh();
  }

  function handleRemove(date: string) {
    removeHoliday(date);
    refresh();
  }

  const days = generateMonth(year, month);
  const firstDow = new Date(year, month - 1, 1).getDay();
  const blanks = Array.from({ length: firstDow });

  if (!authenticated) {
    return (
      <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
        <Sidebar />
        <div className="ml-64 flex items-center justify-center min-h-screen">
          <div className="rounded-2xl bg-white p-10 shadow-lg w-full max-w-sm text-center">
            <div className="text-5xl mb-4">🔐</div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: "#5a5a5a" }}>Manager Access</h1>
            <p className="text-gray-400 text-sm mb-8">Enter your passcode to manage holidays</p>
            <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handlePasscode()} placeholder="Enter passcode" maxLength={6} className={`w-full rounded-xl border px-4 py-3 text-center text-xl tracking-widest font-bold focus:outline-none mb-3 ${passcodeError ? "border-red-300 bg-red-50" : "border-gray-200"}`} />
            {passcodeError && <p className="text-red-500 text-sm mb-3">Incorrect passcode.</p>}
            <button onClick={handlePasscode} className="w-full rounded-xl py-3 font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>Unlock</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="ml-64 p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold" style={{ color: "#5a5a5a" }}>Holidays & Closures</h1>
          <p className="mt-1 text-gray-400">Mark days the office is closed — they'll be blocked on the calendar and schedule</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="rounded-2xl bg-white p-6 shadow">
              <h2 className="text-lg font-bold mb-4" style={{ color: "#5a5a5a" }}>Add Holiday or Closure</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Date</label>
                  <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Name</label>
                  <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Thanksgiving, Staff Training Day" className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-2">Type</label>
                  <div className="flex gap-2">
                    {(["holiday", "closure", "other"] as const).map((t) => (
                      <button key={t} onClick={() => setForm((f) => ({ ...f, type: t }))} className="flex-1 rounded-xl border py-2 text-xs font-semibold transition" style={form.type === t ? { backgroundColor: "#e8622a", borderColor: "#e8622a", color: "white" } : { borderColor: "#e5e7eb", color: "#6b7280" }}>
                        {TYPE_LABELS[t]}
                      </button>
                    ))}
                  </div>
                </div>
                {error && <p className="text-red-500 text-sm">{error}</p>}
                <button onClick={handleAdd} className="w-full rounded-xl py-2.5 text-sm font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#e8622a" }}>
                  + Add to Calendar
                </button>
              </div>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow">
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => { if (month === 1) { setYear(y => y-1); setMonth(12); } else setMonth(m => m-1); }} className="px-2 py-1 text-gray-400 hover:text-gray-700">←</button>
                <span className="font-semibold text-sm" style={{ color: "#5a5a5a" }}>{formatMonthYear(year, month)}</span>
                <button onClick={() => { if (month === 12) { setYear(y => y+1); setMonth(1); } else setMonth(m => m+1); }} className="px-2 py-1 text-gray-400 hover:text-gray-700">→</button>
              </div>
              <div className="grid grid-cols-7 mb-1">
                {DAY_HEADERS.map((h) => <div key={h} style={{ textAlign: "center", fontSize: 10, fontWeight: 600, color: "#9a9a9a", paddingBottom: 4 }}>{h}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {blanks.map((_, i) => <div key={`b${i}`} />)}
                {days.map((day) => {
                  const holiday = holidays.find((h) => h.date === day.date);
                  const isWeekend = !day.isOpen && !holiday;
                  return (
                    <div key={day.date} className="relative rounded-lg p-1 text-center" style={{ background: holiday ? "#fee2e2" : isWeekend ? "#fafafa" : "white", border: holiday ? "1px solid #fca5a5" : "1px solid transparent", minHeight: 36 }}>
                      <div style={{ fontSize: 11, fontWeight: holiday ? 700 : 400, color: holiday ? "#dc2626" : isWeekend ? "#d4d4d4" : "#5a5a5a" }}>{day.day}</div>
                      {holiday && <div style={{ fontSize: 8, color: "#dc2626", lineHeight: 1, marginTop: 1 }}>{holiday.name.slice(0, 8)}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white shadow overflow-hidden">
            <div className="px-6 py-4" style={{ borderBottom: "1px solid #f5f5f5" }}>
              <h2 className="text-lg font-bold" style={{ color: "#5a5a5a" }}>All Holidays & Closures</h2>
              <p className="text-xs text-gray-400 mt-0.5">{holidays.length} day{holidays.length !== 1 ? "s" : ""} marked</p>
            </div>
            <div>
              {holidays.length === 0 ? (
                <div className="p-8 text-center"><p className="text-gray-300 text-sm">No holidays or closures added yet</p></div>
              ) : holidays.map((h) => (
                <div key={h.date} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50" style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <div className="flex items-center gap-3">
                    <div className="text-center" style={{ minWidth: 48 }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "#e8622a" }}>{new Date(h.date + "T00:00:00").getDate()}</div>
                      <div style={{ fontSize: 10, color: "#9a9a9a", textTransform: "uppercase" }}>{new Date(h.date + "T00:00:00").toLocaleDateString("en-US", { month: "short" })}</div>
                    </div>
                    <div>
                      <div className="font-semibold text-sm" style={{ color: "#5a5a5a" }}>{h.name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLES[h.type]}`}>{TYPE_LABELS[h.type]}</span>
                        <span className="text-xs text-gray-400">{new Date(h.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" })}</span>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => handleRemove(h.date)} className="rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-red-50 hover:text-red-600 transition font-medium">Remove</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
