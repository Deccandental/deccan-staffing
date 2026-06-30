"use client";

import { useState, useEffect, useMemo } from "react";
import { loadStaff, loadPrefs, DentistPrefs } from "@/lib/staffStore";
import { buildDailyAssignments } from "@/lib/assignmentEngine";
import { generateMonth, formatMonthYear } from "@/utils/calendar";
import { getOverrides, StaffOverride } from "@/lib/overrides";
import { getOpenTuesdays, OpenTuesday } from "@/lib/openTuesdays";
import { loadSchedule, MonthSchedule } from "@/lib/scheduleStore";
import { loadHolidays, Holiday } from "@/lib/holidays";
import { Employee } from "@/types/employee";
import { TempAssignment, getTempAssignmentsForMonth } from "@/lib/tempAssignments";
import { TempStaff } from "@/app/temps/page";
import { supabase } from "@/lib/supabase";
import PrintSchedule from "./PrintSchedule";
import PrintIndividualScheduleCalendar from "./PrintIndividualScheduleCalendar";

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ROLE_GROUPS = [
  { label: "Dentists", roles: ["Dentist"] },
  { label: "Assistants & RDAs", roles: ["Assistant", "RDA"] },
  { label: "Front Desk", roles: ["Front Desk"] },
  { label: "Hygienists", roles: ["Hygienist"] },
] as const;

interface DentistInfo {
  id: number;
  name: string;
  color: string;
  assistantName: string;
  assistantId: number | null;
}

interface PersonChip {
  id: number | null;
  name: string;
}

interface DayInfo {
  dentists: DentistInfo[];
  frontDesk: PersonChip[];
  hygienists: PersonChip[];
}

async function loadTemps(): Promise<TempStaff[]> {
  const { data, error } = await supabase.from("temps").select("*");
  if (error) { console.error("loadTemps error:", error); return []; }
  return (data ?? []).map((row) => ({
    id: row.id, name: row.name, phone: row.phone ?? "", email: row.email ?? "",
    role: row.role, skills: row.skills ?? [], rating: row.rating ?? 0,
    notes: row.notes ?? "", addedAt: row.added_at,
  }));
}

export default function PublicCalendar() {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [overrides, setOverrides] = useState<StaffOverride[]>([]);
  const [prefs, setPrefs] = useState<DentistPrefs>({});
  const [openTuesdays, setOpenTuesdays] = useState<OpenTuesday[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [schedule, setSchedule] = useState<MonthSchedule>({});
  const [temps, setTemps] = useState<TempStaff[]>([]);
  const [monthTempAssignments, setMonthTempAssignments] = useState<TempAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [s, o, p, ot, h, t] = await Promise.all([
        loadStaff(), getOverrides(), loadPrefs(), getOpenTuesdays(), loadHolidays(), loadTemps()
      ]);
      setStaff(s); setOverrides(o); setPrefs(p);
      setOpenTuesdays(ot); setHolidays(h); setTemps(t);
    }
    load();
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [saved, ta] = await Promise.all([loadSchedule(year, month), getTempAssignmentsForMonth(year, month)]);
      setSchedule(saved); setMonthTempAssignments(ta); setLoading(false);
    }
    load();
  }, [year, month]);

  useEffect(() => { setSelectedDate(null); }, [year, month]);

  const days = generateMonth(year, month, openTuesdays, holidays);
  const firstDow = new Date(year, month - 1, 1).getDay();
  const blanks = Array.from({ length: firstDow });

  const monthAssignments = useMemo(() => {
    const result: Record<string, DayInfo> = {};
    const firstName = (name: string) => name.split(" ")[0];

    for (const day of days) {
      if (!day.isOpen) continue;
      const daySched = schedule[day.date];
      if (!daySched || daySched.dentists.length === 0) continue;

      const frontDeskRequired = daySched.frontDeskRequired ?? 2;
      const hygienistsRequired = daySched.hygienistsRequired ?? 1;

      const assignments = buildDailyAssignments(
        staff, daySched.dentists, day.date, prefs, overrides,
        day.isTuesday && day.isOpenTuesday, frontDeskRequired, hygienistsRequired
      );

      const tempsForDay = monthTempAssignments.filter((ta) => ta.date === day.date);
      const tempName = (tempId: string) => firstName(temps.find((t) => t.id === tempId)?.name ?? "Temp");

      const ao = daySched.assistantOverrides ?? {};
      const dentists: DentistInfo[] = assignments.dentists.map(({ dentist, assistant }) => {
        const tempForDentist = tempsForDay.find((ta) => ta.role === "Assistant" && ta.notes === `dentist:${dentist.id}`);
        if (tempForDentist) return { id: dentist.id, name: dentist.name, color: dentist.color, assistantName: `${tempName(tempForDentist.tempId)} (temp)`, assistantId: null };
        let resolvedAssistant = assistant;
        if (dentist.id in ao) {
          const ovId = ao[dentist.id];
          resolvedAssistant = ovId != null ? staff.find((e) => e.id === ovId) ?? null : null;
        }
        return resolvedAssistant
          ? { id: dentist.id, name: dentist.name, color: dentist.color, assistantName: firstName(resolvedAssistant.name), assistantId: resolvedAssistant.id }
          : { id: dentist.id, name: dentist.name, color: dentist.color, assistantName: "???", assistantId: null };
      });

      const ho = daySched.hygienistOverrides ?? {};
      const resolvedHygienists = Array.from({ length: hygienistsRequired }, (_, i) => {
        if (i in ho) { const ovId = ho[i]; return ovId != null ? staff.find((e) => e.id === ovId) ?? null : null; }
        return assignments.hygienists[i] ?? null;
      }).filter(Boolean) as Employee[];

      const frontDesk: PersonChip[] = [
        ...assignments.frontDesk.map((e) => ({ id: e.id, name: firstName(e.name) })),
        ...tempsForDay.filter((ta) => ta.role === "Front Desk").map((ta) => ({ id: null, name: `${tempName(ta.tempId)} (temp)` })),
      ];
      if (frontDesk.length === 0 && frontDeskRequired > 0) frontDesk.push({ id: null, name: "???" });

      const hygienists: PersonChip[] = [
        ...resolvedHygienists.map((e) => ({ id: e.id, name: firstName(e.name) })),
        ...tempsForDay.filter((ta) => ta.role === "Hygienist").map((ta) => ({ id: null, name: `${tempName(ta.tempId)} (temp)` })),
      ];
      if (hygienists.length === 0 && hygienistsRequired > 0) hygienists.push({ id: null, name: "???" });

      result[day.date] = { dentists, frontDesk, hygienists };
    }
    return result;
  }, [days, schedule, staff, prefs, overrides, monthTempAssignments, temps]);

  function isPersonWorkingOn(date: string): boolean {
    if (!highlightId) return false;
    const info = monthAssignments[date];
    if (!info) return false;
    if (info.dentists.some((d) => d.id === highlightId || d.assistantId === highlightId)) return true;
    if (info.frontDesk.some((c) => c.id === highlightId)) return true;
    if (info.hygienists.some((c) => c.id === highlightId)) return true;
    return false;
  }

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1);
  }

  const highlightedPerson = highlightId ? staff.find((e) => e.id === highlightId) : null;
  const selectedInfo = selectedDate ? monthAssignments[selectedDate] : null;
  const selectedDay = selectedDate ? days.find((d) => d.date === selectedDate) : null;

  function DetailPanel() {
    if (!selectedDate || !selectedDay) return null;

    const dateLabel = new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric",
    });

    if (!selectedInfo) {
      return (
        <div className="rounded-2xl bg-white p-5 shadow mt-4">
          <div className="font-semibold text-slate-700 mb-1">{dateLabel}</div>
          <div className="text-sm text-slate-400">{selectedDay.isHoliday ? `🏖️ ${selectedDay.holidayName}` : "Not scheduled"}</div>
        </div>
      );
    }

    if (highlightId && highlightedPerson) {
      const dentistPair = selectedInfo.dentists.find((d) => d.id === highlightId);
      const assistantPair = selectedInfo.dentists.find((d) => d.assistantId === highlightId);
      const onFront = selectedInfo.frontDesk.find((c) => c.id === highlightId);
      const onHyg = selectedInfo.hygienists.find((c) => c.id === highlightId);

      let roleLabel = "";
      let detail = "";

      if (dentistPair) { roleLabel = "Dentist"; detail = `w/ ${dentistPair.assistantName}`; }
      else if (assistantPair) { roleLabel = "Assistant"; detail = `w/ ${assistantPair.name}`; }
      else if (onFront) { roleLabel = "Front Desk"; }
      else if (onHyg) { roleLabel = "Hygienist"; }
      else {
        return (
          <div className="rounded-2xl bg-white p-5 shadow mt-4">
            <div className="font-semibold text-slate-700 mb-1">{dateLabel}</div>
            <div className="text-sm text-slate-400">{highlightedPerson.name} is not scheduled this day.</div>
          </div>
        );
      }

      return (
        <div className="rounded-2xl bg-white p-5 shadow mt-4">
          <div className="text-sm text-slate-400 mb-3">{dateLabel}</div>
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0"
              style={{ backgroundColor: highlightedPerson.color }}>
              {highlightedPerson.name.charAt(0)}
            </div>
            <div>
              <div className="font-bold text-slate-700 text-base">{highlightedPerson.name}</div>
              <div className="text-sm font-semibold mt-0.5" style={{ color: highlightedPerson.color }}>{roleLabel}{detail ? ` — ${detail}` : ""}</div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="rounded-2xl bg-white p-5 shadow mt-4">
        <div className="font-semibold text-slate-700 mb-3">{dateLabel}</div>
        <div className="space-y-2">
          {selectedInfo.dentists.map((d) => (
            <div key={d.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
              <span className="font-semibold text-sm" style={{ color: d.color }}>{d.name}</span>
              <span className="text-slate-400 text-sm">/{" "}{d.assistantName === "???" ? <span className="text-amber-500 font-bold">???</span> : d.assistantName}</span>
            </div>
          ))}
          {selectedInfo.frontDesk.length > 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
              <span className="text-xs font-bold text-sky-600 w-12 flex-shrink-0">Front</span>
              <span className="text-sm text-slate-600">{selectedInfo.frontDesk.map((c) => c.name).join(" / ")}</span>
            </div>
          )}
          {selectedInfo.hygienists.length > 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
              <span className="text-xs font-bold text-emerald-600 w-12 flex-shrink-0">Hyg</span>
              <span className="text-sm text-slate-600">{selectedInfo.hygienists.map((c) => c.name).join(" / ")}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  function CalendarGrid({ mobile }: { mobile: boolean }) {
    return (
      <div className={mobile ? "" : "rounded-2xl bg-white p-6 shadow"}>
        <div className="grid grid-cols-7 mb-2">
          {DAY_HEADERS.map((h) => (
            <div key={h} className={`py-1 text-center text-xs font-bold uppercase tracking-wide ${
              h === "Sun" || h === "Sat" ? "text-slate-300" : h === "Tue" ? "text-blue-400" : "text-slate-500"
            }`}>{h}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {blanks.map((_, i) => <div key={`b${i}`} />)}
          {days.map((day) => {
            const isToday = day.date === todayStr;
            const isSelected = selectedDate === day.date;
            const info = monthAssignments[day.date];
            const isOpenTue = day.isTuesday && day.isOpenTuesday;

            let showDot = false;
            let dotColor = "#64748b";
            if (highlightId) {
              showDot = isPersonWorkingOn(day.date);
              dotColor = highlightedPerson?.color ?? "#64748b";
            } else {
              showDot = !!info;
              dotColor = "#e8622a";
            }

            if (mobile) {
              if (!day.isOpen) {
                return (
                  <div key={day.date} className="flex flex-col items-center py-1">
                    <div className={`w-9 h-9 flex items-center justify-center rounded-full text-base font-semibold ${
                      day.isHoliday ? "text-red-300" : "text-slate-200"
                    }`}>{day.day}</div>
                  </div>
                );
              }
              return (
                <div key={day.date} className="flex flex-col items-center py-1 cursor-pointer"
                  onClick={() => setSelectedDate(isSelected ? null : day.date)}>
                  <div className={`w-9 h-9 flex items-center justify-center rounded-full text-base font-semibold transition ${
                    isSelected ? "text-white shadow-md"
                    : isToday ? "text-white"
                    : isOpenTue ? "text-blue-600 font-bold"
                    : "text-slate-700"
                  }`} style={isSelected ? { backgroundColor: "#e8622a" } : isToday ? { backgroundColor: "#0891b2" } : {}}>
                    {day.day}
                  </div>
                  <div className="h-1.5 mt-0.5 flex items-center justify-center">
                    {showDot && !isSelected && (
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dotColor }} />
                    )}
                  </div>
                </div>
              );
            }

            if (!day.isOpen) {
              return (
                <div key={day.date} className="rounded-xl p-3 text-center select-none min-h-[100px] flex flex-col"
                  style={{ opacity: day.isHoliday ? 1 : 0.3, background: day.isHoliday ? "#fef2f2" : "transparent" }}>
                  <div className={`text-sm ${day.isHoliday ? "text-red-400" : "text-slate-400"}`}>{day.weekday}</div>
                  <div className={`text-xl font-bold ${day.isHoliday ? "text-red-500" : "text-slate-400"}`}>{day.day}</div>
                  {day.isHoliday && <div className="text-xs text-red-400 mt-1">{day.holidayName}</div>}
                </div>
              );
            }

            const borderColor = isToday ? "border-cyan-500" : isOpenTue && !info ? "border-blue-200" : "border-slate-200";
            const bgColor = isToday ? "bg-cyan-50" : "bg-white";

            return (
              <div key={day.date} className={`rounded-xl border-2 p-3 text-left min-h-[100px] flex flex-col ${borderColor} ${bgColor}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`text-sm font-medium ${isToday ? "text-cyan-600" : isOpenTue ? "text-blue-400" : "text-slate-400"}`}>{day.weekday}</span>
                  <span className={`text-xl font-bold ${isToday ? "text-cyan-600" : "text-slate-700"}`}>{day.day}</span>
                </div>
                {info ? (
                  <div className="space-y-1 overflow-hidden">
                    {info.dentists.map((d) => {
                      const dentistMatch = d.id === highlightId;
                      const assistantMatch = d.assistantId === highlightId;
                      const rowMatch = dentistMatch || assistantMatch;
                      const rowDim = highlightId !== null && !rowMatch;
                      return (
                        <div key={d.id} className="text-sm leading-snug truncate" style={{ opacity: rowDim ? 0.25 : 1 }} title={`${d.name} / ${d.assistantName}`}>
                          <span className={dentistMatch ? "font-bold bg-cyan-100 rounded px-1" : "font-bold"} style={{ color: d.color }}>{d.name}</span>
                          <span className={`${d.assistantName === "???" ? "text-amber-600 font-bold" : "text-slate-600 font-medium"} ${assistantMatch ? "bg-cyan-100 text-cyan-800 rounded px-1" : ""}`}>
                            /{d.assistantName}
                          </span>
                        </div>
                      );
                    })}
                    {info.frontDesk.length > 0 && (() => {
                      const rowMatch = info.frontDesk.some((c) => c.id === highlightId);
                      const rowDim = highlightId !== null && !rowMatch;
                      return (
                        <div className="text-sm leading-snug truncate" style={{ opacity: rowDim ? 0.25 : 1 }}>
                          <span className="font-bold text-sky-600">Front:</span>{" "}
                          {info.frontDesk.map((c, i) => (
                            <span key={i}>
                              {i > 0 && <span className="text-slate-400">/</span>}
                              <span className={`${c.name === "???" ? "text-amber-600 font-bold" : "text-slate-600 font-medium"} ${c.id === highlightId ? "bg-cyan-100 text-cyan-800 rounded px-1" : ""}`}>{c.name}</span>
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                    {info.hygienists.length > 0 && (() => {
                      const rowMatch = info.hygienists.some((c) => c.id === highlightId);
                      const rowDim = highlightId !== null && !rowMatch;
                      return (
                        <div className="text-sm leading-snug truncate" style={{ opacity: rowDim ? 0.25 : 1 }}>
                          <span className="font-bold text-emerald-600">Hyg:</span>{" "}
                          {info.hygienists.map((c, i) => (
                            <span key={i}>
                              {i > 0 && <span className="text-slate-400">/</span>}
                              <span className={`${c.name === "???" ? "text-amber-600 font-bold" : "text-slate-600 font-medium"} ${c.id === highlightId ? "bg-cyan-100 text-cyan-800 rounded px-1" : ""}`}>{c.name}</span>
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  !loading && (
                    <div className="flex-1 flex items-center">
                      <span className="text-sm text-slate-300">{isOpenTue ? "Open Tuesday" : "Not scheduled"}</span>
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl bg-white p-4 shadow flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={prevMonth} className="rounded-xl border px-3 py-2 text-xl text-slate-500 hover:bg-slate-50 transition">←</button>
          <span className="text-xl lg:text-3xl font-bold min-w-[160px] lg:min-w-[260px] text-center">{formatMonthYear(year, month)}</span>
          <button onClick={nextMonth} className="rounded-xl border px-3 py-2 text-xl text-slate-500 hover:bg-slate-50 transition">→</button>
        </div>
        <div className="hidden lg:flex items-center gap-3">
          <PrintSchedule year={year} month={month} schedule={schedule} />
          <PrintIndividualScheduleCalendar year={year} month={month} schedule={schedule} />
        </div>
      </div>

      {/* Spotlight */}
      <div className="rounded-2xl border-2 border-cyan-200 bg-cyan-50 p-3 shadow flex items-center gap-3 flex-wrap">
        <span className="text-sm font-bold text-cyan-700">🔦 Spotlight:</span>
        <select
          value={highlightId ?? ""}
          onChange={(e) => { setHighlightId(e.target.value ? Number(e.target.value) : null); setSelectedDate(null); }}
          className="rounded-xl border-2 border-cyan-300 bg-white px-3 py-2 text-sm font-bold text-cyan-700 focus:outline-none focus:border-cyan-500 flex-1 lg:flex-none"
        >
          <option value="">— None, show everyone —</option>
          {ROLE_GROUPS.map(({ label, roles }) => {
            const members = staff.filter((e) => (roles as readonly string[]).includes(e.role));
            if (members.length === 0) return null;
            return (
              <optgroup key={label} label={label}>
                {members.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </optgroup>
            );
          })}
        </select>
        {highlightId !== null && (
          <button onClick={() => { setHighlightId(null); setSelectedDate(null); }}
            className="rounded-xl border-2 border-cyan-300 bg-white px-3 py-2 text-sm font-bold text-cyan-700 hover:bg-cyan-100 transition">
            ✕ Clear
          </button>
        )}
      </div>

      {/* Mobile */}
      <div className="lg:hidden">
        <div className="rounded-2xl bg-white p-4 shadow">
          {highlightedPerson && (
            <div className="flex items-center gap-2 mb-4 px-1">
              <div className="h-7 w-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{ backgroundColor: highlightedPerson.color }}>
                {highlightedPerson.name.charAt(0)}
              </div>
              <div>
                <div className="text-sm font-bold text-slate-700">{highlightedPerson.name}</div>
                <div className="text-xs text-slate-400">Tap a dot to see schedule</div>
              </div>
            </div>
          )}
          {!highlightedPerson && (
            <div className="text-xs text-slate-400 mb-3 px-1">Tap any date to see the full schedule</div>
          )}
          <CalendarGrid mobile={true} />
        </div>
        <DetailPanel />
      </div>

      {/* Desktop */}
      <div className="hidden lg:block">
        <CalendarGrid mobile={false} />
      </div>

      {/* Print buttons on mobile */}
      <div className="lg:hidden flex gap-3">
        <PrintSchedule year={year} month={month} schedule={schedule} />
        <PrintIndividualScheduleCalendar year={year} month={month} schedule={schedule} />
      </div>
    </div>
  );
}
