"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { generateMonth, formatMonthYear } from "@/utils/calendar";
import { buildDailyAssignments, DailyAssignmentsResult } from "@/lib/assignmentEngine";
import { loadStaff } from "@/lib/staffStore";
import { Employee } from "@/types/employee";

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const SCHEDULE_KEY = "deccan-schedule-v1";

function loadSchedule(): Record<string, { dentists: string[] }> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(SCHEDULE_KEY) ?? "{}"); }
  catch { return {}; }
}

export default function HomeCalendar() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [schedule, setSchedule] = useState<Record<string, { dentists: string[] }>>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    setStaff(loadStaff());
    setSchedule(loadSchedule());
  }, []);

  const days = generateMonth(year, month);
  const firstDow = new Date(year, month - 1, 1).getDay();
  const blanks = Array.from({ length: firstDow });

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1);
    setSelectedDate(null);
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1);
    setSelectedDate(null);
  }

  const selectedAssignments: DailyAssignmentsResult | null = useMemo(() => {
    if (!selectedDate) return null;
    const daySched = schedule[selectedDate];
    if (!daySched) return null;
    return buildDailyAssignments(staff, daySched.dentists, selectedDate);
  }, [selectedDate, schedule, staff]);

  const isToday = (date: string) => {
    return date === today.toISOString().split("T")[0];
  };

  function getDayStatus(date: string): "complete" | "warning" | "empty" {
    const daySched = schedule[date];
    if (!daySched || daySched.dentists.length === 0) return "empty";
    const assignments = buildDailyAssignments(staff, daySched.dentists, date);
    if (assignments.warnings.some((w) => w.severity === "error")) return "warning";
    if (assignments.warnings.length > 0) return "warning";
    return "complete";
  }

  const selectedDateLabel = selectedDate
    ? new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    : "";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{formatMonthYear(year, month)}</h1>
          <p className="mt-1 text-slate-500">Deccan Dental — Monthly Schedule</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={prevMonth} className="rounded-xl border bg-white px-4 py-2 text-slate-500 hover:bg-slate-50 shadow transition">←</button>
          <button
            onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth() + 1); }}
            className="rounded-xl border bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 shadow transition"
          >
            Today
          </button>
          <button onClick={nextMonth} className="rounded-xl border bg-white px-4 py-2 text-slate-500 hover:bg-slate-50 shadow transition">→</button>
          <Link
            href="/schedule-builder"
            className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition shadow" style={{ backgroundColor: "#e8622a" }}
          >
            ✏️ Build / Edit Schedule
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Calendar */}
        <div className="lg:col-span-2 rounded-2xl bg-white shadow p-5">
          {/* Legend */}
          <div className="flex items-center gap-4 mb-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-green-400" /> Fully staffed</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-amber-400" /> Has warnings</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-slate-200" /> Not scheduled</span>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAY_HEADERS.map((h) => (
              <div key={h} className={`py-2 text-center text-xs font-semibold uppercase tracking-wide ${h === "Sun" || h === "Sat" || h === "Tue" ? "text-slate-300" : "text-slate-400"}`}>
                {h}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-1">
            {blanks.map((_, i) => <div key={`b${i}`} />)}
            {days.map((day) => {
              const isSelected = selectedDate === day.date;
              const todayStyle = isToday(day.date);
              const status = day.isOpen ? getDayStatus(day.date) : null;
              const daySched = schedule[day.date];
              const dentistCount = daySched?.dentists.length ?? 0;

              if (!day.isOpen) {
                return (
                  <div key={day.date} className="rounded-xl p-1.5 text-center opacity-25 select-none min-h-[70px]">
                    <div className="text-xs text-slate-400">{day.weekday}</div>
                    <div className="text-sm font-medium text-slate-400">{day.day}</div>
                  </div>
                );
              }

              return (
                <button
                  key={day.date}
                  onClick={() => setSelectedDate(isSelected ? null : day.date)}
                  className={`rounded-xl border p-1.5 text-left transition min-h-[70px] flex flex-col ${
                    isSelected
                      ? "border-cyan-500 bg-cyan-500 text-white shadow-md"
                      : status === "complete"
                      ? "border-green-200 bg-green-50 hover:bg-green-100"
                      : status === "warning"
                      ? "border-amber-200 bg-amber-50 hover:bg-amber-100"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  } ${todayStyle && !isSelected ? "ring-2 ring-cyan-400" : ""}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs ${isSelected ? "text-cyan-100" : "text-slate-400"}`}>{day.weekday}</span>
                    <span className={`text-sm font-bold ${todayStyle && !isSelected ? "text-cyan-600" : ""}`}>{day.day}</span>
                  </div>
                  {dentistCount > 0 && (
                    <div className={`text-xs mt-auto ${isSelected ? "text-cyan-100" : "text-slate-500"}`}>
                      {dentistCount} dentist{dentistCount !== 1 ? "s" : ""}
                      {status === "complete" && !isSelected && <span className="ml-1 text-green-500">✓</span>}
                      {status === "warning" && !isSelected && <span className="ml-1 text-amber-500">⚠</span>}
                    </div>
                  )}
                  {dentistCount === 0 && (
                    <div className={`text-xs mt-auto ${isSelected ? "text-cyan-200" : "text-slate-300"}`}>Not set</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Day detail panel */}
        <div className="rounded-2xl bg-white shadow p-5">
          {selectedDate && selectedAssignments ? (
            <div>
              <div className="mb-4 pb-4 border-b">
                <h2 className="font-bold text-lg">{selectedDateLabel}</h2>
                {selectedAssignments.warnings.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {selectedAssignments.warnings.map((w, i) => (
                      <p key={i} className={`text-xs ${w.severity === "error" ? "text-red-500" : "text-amber-500"}`}>
                        {w.severity === "error" ? "🔴" : "⚠️"} {w.message}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Dentist / Assistant</h3>
                  {selectedAssignments.dentists.length === 0 ? (
                    <p className="text-sm text-slate-300">No dentists</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedAssignments.dentists.map(({ dentist, assistant }) => (
                        <div key={dentist.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                          <span className="flex items-center gap-2 text-sm font-medium">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: dentist.color }} />
                            {dentist.name}
                          </span>
                          <span className={`text-xs ${assistant ? "text-slate-500" : "text-amber-400"}`}>
                            {assistant ? (
                              <span className="flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: assistant.color }} />
                                {assistant.name}
                              </span>
                            ) : "No assistant"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Front Desk</h3>
                  {selectedAssignments.frontDesk.length === 0 ? (
                    <p className="text-sm text-slate-300">None</p>
                  ) : selectedAssignments.frontDesk.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm mb-1">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />
                      {e.name}
                    </div>
                  ))}
                </div>

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Hygienist</h3>
                  {selectedAssignments.hygienists.length === 0 ? (
                    <p className="text-sm text-slate-300">None</p>
                  ) : selectedAssignments.hygienists.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm mb-1">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />
                      {e.name}
                    </div>
                  ))}
                </div>

                <Link
                  href={`/schedule-builder?step=3`}
                  className="block text-center rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-medium text-cyan-700 hover:bg-cyan-100 transition mt-2"
                >
                  ✏️ Edit this day
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <div className="text-4xl mb-3">📅</div>
              <p className="text-slate-400 text-sm">Click any day on the calendar to see the staffing details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
