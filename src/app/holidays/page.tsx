"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import PasscodeGate from "@/components/PasscodeGate";
import { Holiday, loadHolidays, addHoliday, removeHoliday } from "@/lib/holidays";
import { generateMonth, formatMonthYear } from "@/utils/calendar";
import { OpenTuesday, getOpenTuesdays, addOpenTuesday, removeOpenTuesday } from "@/lib/openTuesdays";

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

function HolidaysPageBody() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [openTuesdays, setOpenTuesdays] = useState<OpenTuesday[]>([]);
  const [form, setForm] = useState({ date: "", name: "", type: "holiday" as Holiday["type"] });
  const [tuesdayForm, setTuesdayForm] = useState({ date: "", halfDay: null as "AM" | "PM" | null });
  const [error, setError] = useState("");
  const [tuesdayError, setTuesdayError] = useState("");
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    const [h, ot] = await Promise.all([loadHolidays(), getOpenTuesdays()]);
    setHolidays(h.sort((a, b) => a.date.localeCompare(b.date)));
    setOpenTuesdays(ot.sort((a, b) => a.date.localeCompare(b.date)));
  }

  async function handleAdd() {
    setError("");
    if (!form.date) { setError("Please select a date."); return; }
    if (!form.name.trim()) { setError("Please enter a name."); return; }
    await addHoliday({ date: form.date, name: form.name.trim(), type: form.type });
    setForm({ date: "", name: "", type: "holiday" });
    await refresh();
  }

  async function handleRemove(date: string) {
    await removeHoliday(date);
    await refresh();
  }

  async function handleAddTuesday() {
    setTuesdayError("");
    if (!tuesdayForm.date) { setTuesdayError("Please select a Tuesday."); return; }
    const dow = new Date(tuesdayForm.date + "T00:00:00").getDay();
    if (dow !== 2) { setTuesdayError("Please select a Tuesday date."); return; }
    await addOpenTuesday(tuesdayForm.date, tuesdayForm.halfDay);
    setTuesdayForm({ date: "", halfDay: null });
    await refresh();
  }

  async function handleRemoveTuesday(date: string) {
    await removeOpenTuesday(date);
    await refresh();
  }

  const days = generateMonth(year, month, openTuesdays, holidays);
  const firstDow = new Date(year, month - 1, 1).getDay();
  const blanks = Array.from({ length: firstDow });

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-16 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold" style={{ color: "#5a5a5a" }}>Holidays & Closures</h1>
          <p className="mt-1 text-gray-400">Mark days the office is closed, or open Tuesdays when needed</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">

            <div className="rounded-2xl bg-white p-6 shadow">
              <h2 className="text-lg font-bold mb-4" style={{ color: "#5a5a5a" }}>Add Holiday or Closure</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Date</label>
                  <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Name</label>
                  <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Thanksgiving, Staff Training Day"
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-2">Type</label>
                  <div className="flex gap-2">
                    {(["holiday", "closure", "other"] as const).map((t) => (
                      <button key={t} onClick={() => setForm((f) => ({ ...f, type: t }))}
                        className="flex-1 rounded-xl border py-2 text-xs font-semibold transition"
                        style={form.type === t ? { backgroundColor: "#e8622a", borderColor: "#e8622a", color: "white" } : { borderColor: "#e5e7eb", color: "#6b7280" }}>
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

            <div className="rounded-2xl bg-white p-6 shadow">
              <h2 className="text-lg font-bold mb-1" style={{ color: "#5a5a5a" }}>Open Tuesdays</h2>
              <p className="text-xs text-gray-400 mb-4">Mark specific Tuesdays when the office is open</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Select a Tuesday</label>
                  <input type="date" value={tuesdayForm.date} onChange={(e) => setTuesdayForm((f) => ({ ...f, date: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-2">Open for</label>
                  <div className="flex gap-2">
                    {([
                      { label: "Full Day", value: null },
                      { label: "AM Only", value: "AM" as const },
                      { label: "PM Only", value: "PM" as const },
                    ]).map((opt) => (
                      <button key={String(opt.value)} onClick={() => setTuesdayForm((f) => ({ ...f, halfDay: opt.value }))}
                        className="flex-1 rounded-xl border py-2 text-xs font-semibold transition"
                        style={tuesdayForm.halfDay === opt.value ? { backgroundColor: "#e8622a", borderColor: "#e8622a", color: "white" } : { borderColor: "#e5e7eb", color: "#6b7280" }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {tuesdayError && <p className="text-red-500 text-sm">{tuesdayError}</p>}
                <button onClick={handleAddTuesday} className="w-full rounded-xl py-2.5 text-sm font-semibold text-white hover:opacity-90 transition" style={{ backgroundColor: "#2563eb" }}>
                  + Mark Tuesday as Open
                </button>
              </div>

              {openTuesdays.length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Scheduled Open Tuesdays</div>
                  {openTuesdays.map((t) => (
                    <div key={t.date} className="flex items-center justify-between rounded-xl bg-blue-50 px-4 py-2.5">
                      <div>
                        <div className="text-sm font-semibold" style={{ color: "#1e40af" }}>
                          {new Date(t.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                        </div>
                        <div className="text-xs text-blue-400">{t.halfDay ? `${t.halfDay} only` : "Full day"}</div>
                      </div>
                      <button onClick={() => handleRemoveTuesday(t.date)} className="rounded-lg px-3 py-1 text-xs text-red-400 hover:bg-red-50 hover:text-red-600 transition font-medium">Remove</button>
                    </div>
                  ))}
                </div>
              )}
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
                  const isOpenTue = day.isOpenTuesday;
                  const isClosedTue = day.isTuesday && !isOpenTue;
                  return (
                    <div key={day.date} className="relative rounded-lg p-1 text-center"
                      style={{
                        background: holiday ? "#fee2e2" : isOpenTue ? "#dbeafe" : isClosedTue ? "#fafafa" : "white",
                        border: holiday ? "1px solid #fca5a5" : isOpenTue ? "1px solid #93c5fd" : "1px solid transparent",
                        minHeight: 36,
                      }}>
                      <div style={{ fontSize: 11, fontWeight: holiday || isOpenTue ? 700 : 400, color: holiday ? "#dc2626" : isOpenTue ? "#1d4ed8" : isClosedTue ? "#d4d4d4" : "#5a5a5a" }}>
                        {day.day}
                      </div>
                      {holiday && <div style={{ fontSize: 8, color: "#dc2626", lineHeight: 1, marginTop: 1 }}>{holiday.name.slice(0, 8)}</div>}
                      {isOpenTue && <div style={{ fontSize: 8, color: "#1d4ed8", lineHeight: 1, marginTop: 1 }}>{day.tuesdayHalfDay ?? "Open"}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-4">
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
      </div>
    </main>
  );
}

export default function HolidaysPage() {
  return (
    <PasscodeGate group="admin" subtitle="Enter your passcode to manage holidays & closures">
      <HolidaysPageBody />
    </PasscodeGate>
  );
}
