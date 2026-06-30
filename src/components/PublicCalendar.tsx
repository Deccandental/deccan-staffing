"use client";

import { useState, useEffect, useMemo, CSSProperties } from "react";
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
  id: number | null; // null for temp staff (they're never the highlight target)
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

  useEffect(() => {
    async function load() {
      const [s, o, p, ot, h, t] = await Promise.all([
        loadStaff(), getOverrides(), loadPrefs(), getOpenTuesdays(), loadHolidays(), loadTemps()
      ]);
      setStaff(s);
      setOverrides(o);
      setPrefs(p);
      setOpenTuesdays(ot);
      setHolidays(h);
      setTemps(t);
    }
    load();
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [saved, ta] = await Promise.all([
        loadSchedule(year, month),
        getTempAssignmentsForMonth(year, month),
      ]);
      setSchedule(saved);
      setMonthTempAssignments(ta);
      setLoading(false);
    }
    load();
  }, [year, month]);

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
        day.isTuesday && day.isOpenTuesday,
        frontDeskRequired,
        hygienistsRequired
      );

      const tempsForDay = monthTempAssignments.filter((ta) => ta.date === day.date);
      const tempName = (tempId: string) => firstName(temps.find((t) => t.id === tempId)?.name ?? "Temp");

      const ao = daySched.assistantOverrides ?? {};
      const dentists: DentistInfo[] = assignments.dentists.map(({ dentist, assistant }) => {
        const tempForDentist = tempsForDay.find(
          (ta) => ta.role === "Assistant" && ta.notes === `dentist:${dentist.id}`
        );
        if (tempForDentist) {
          return { id: dentist.id, name: dentist.name, color: dentist.color, assistantName: `${tempName(tempForDentist.tempId)} (temp)`, assistantId: null };
        }
        let resolvedAssistant = assistant;
        if (dentist.id in ao) {
          const ovId = ao[dentist.id];
          resolvedAssistant = ovId != null ? staff.find((e) => e.id === ovId) ?? null : null;
        }
        return resolvedAssistant
          ? { id: dentist.id, name: dentist.name, color: dentist.color, assistantName: firstName(resolvedAssistant.name), assistantId: resolvedAssistant.id }
          : { id: dentist.id, name: dentist.name, color: dentist.color, assistantName: "???", assistantId: null };
      });

      const frontDesk: PersonChip[] = [
        ...assignments.frontDesk.map((e) => ({ id: e.id, name: firstName(e.name) })),
        ...tempsForDay.filter((ta) => ta.role === "Front Desk").map((ta) => ({ id: null, name: `${tempName(ta.tempId)} (temp)` })),
      ];
      if (frontDesk.length === 0 && frontDeskRequired > 0) frontDesk.push({ id: null, name: "???" });

      const hygienists: PersonChip[] = [
        ...assignments.hygienists.map((e) => ({ id: e.id, name: firstName(e.name) })),
        ...tempsForDay.filter((ta) => ta.role === "Hygienist").map((ta) => ({ id: null, name: `${tempName(ta.tempId)} (temp)` })),
      ];
      if (hygienists.length === 0 && hygienistsRequired > 0) hygienists.push({ id: null, name: "???" });

      result[day.date] = { dentists, frontDesk, hygienists };
    }
    return result;
  }, [days, schedule, staff, prefs, overrides, monthTempAssignments, temps]);

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1);
  }

  // Opacity for a name given whether it matches the highlighted person.
  // No highlight active -> everything full strength.
  function dimStyle(isMatch: boolean): CSSProperties {
    if (highlightId === null) return {};
    return isMatch ? {} : { opacity: 0.25 };
  }
  function chipClass(isMatch: boolean, base: string) {
    if (highlightId === null) return base;
    return isMatch ? `${base} bg-cyan-100 text-cyan-800 rounded px-1` : base;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-5 shadow flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <button onClick={prevMonth} className="rounded-xl border px-4 py-2.5 text-xl text-slate-500 hover:bg-slate-50 transition">←</button>
          <span className="text-3xl font-bold min-w-[260px] text-center">{formatMonthYear(year, month)}</span>
          <button onClick={nextMonth} className="rounded-xl border px-4 py-2.5 text-xl text-slate-500 hover:bg-slate-50 transition">→</button>
        </div>
        <div className="flex items-center gap-3">
          <PrintSchedule year={year} month={month} schedule={schedule} />
          <PrintIndividualScheduleCalendar year={year} month={month} schedule={schedule} />
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow flex items-center gap-3 flex-wrap">
        <span className="text-sm font-semibold text-slate-500">Highlight:</span>
        <select
          value={highlightId ?? ""}
          onChange={(e) => setHighlightId(e.target.value ? Number(e.target.value) : null)}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium focus:outline-none"
        >
          <option value="">None — show everyone</option>
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
          <button onClick={() => setHighlightId(null)} className="text-sm text-slate-400 hover:text-slate-600 underline">
            Clear
          </button>
        )}
      </div>

      <div className="rounded-2xl bg-white p-6 shadow">
        <div className="grid grid-cols-7 mb-3">
          {DAY_HEADERS.map((h) => (
            <div key={h} className={`py-2 text-center text-sm font-bold uppercase tracking-wide ${
              h === "Sun" || h === "Sat" ? "text-slate-300" : h === "Tue" ? "text-blue-400" : "text-slate-500"
            }`}>
              {h}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-2">
          {blanks.map((_, i) => <div key={`b${i}`} />)}
          {days.map((day) => {
            const isToday = day.date === todayStr;
            const isOpenTue = day.isTuesday && day.isOpenTuesday;
            const info = monthAssignments[day.date];

            if (!day.isOpen) {
              return (
                <div key={day.date} className="rounded-xl p-3 text-center select-none min-h-[100px] sm:min-h-[130px] flex flex-col"
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
              <div key={day.date}
                className={`rounded-xl border-2 p-3 text-left min-h-[100px] sm:min-h-[130px] flex flex-col ${borderColor} ${bgColor}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`text-sm font-medium ${isToday ? "text-cyan-600" : isOpenTue ? "text-blue-400" : "text-slate-400"}`}>{day.weekday}</span>
                  <span className={`text-xl font-bold ${isToday ? "text-cyan-600" : "text-slate-700"}`}>{day.day}</span>
                </div>

                {info ? (
                  <div className="space-y-1 overflow-hidden">
                    {info.dentists.map((d) => {
                      const dentistMatch = d.id === highlightId;
                      const assistantMatch = d.assistantId === highlightId;
                      return (
                        <div key={d.id} className="text-sm leading-snug truncate" title={`${d.name} / ${d.assistantName}`}>
                          <span className="font-bold" style={{ color: d.color, ...dimStyle(dentistMatch) }}>{d.name}</span>
                          <span
                            className={d.assistantName === "???" ? chipClass(assistantMatch, "text-amber-600 font-bold") : chipClass(assistantMatch, "text-slate-600 font-medium")}
                            style={dimStyle(assistantMatch)}
                          >
                            /{d.assistantName}
                          </span>
                        </div>
                      );
                    })}
                    {info.frontDesk.length > 0 && (
                      <div className="text-sm leading-snug truncate" title={`Front: ${info.frontDesk.map((c) => c.name).join("/")}`}>
                        <span className="font-bold text-sky-600">Front:</span>{" "}
                        {info.frontDesk.map((c, i) => {
                          const isMatch = c.id === highlightId;
                          return (
                            <span key={i}>
                              {i > 0 && <span className="text-slate-400">/</span>}
                              <span
                                className={c.name === "???" ? chipClass(isMatch, "text-amber-600 font-bold") : chipClass(isMatch, "text-slate-600 font-medium")}
                                style={dimStyle(isMatch)}
                              >
                                {c.name}
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {info.hygienists.length > 0 && (
                      <div className="text-sm leading-snug truncate" title={`Hyg: ${info.hygienists.map((c) => c.name).join("/")}`}>
                        <span className="font-bold text-emerald-600">Hyg:</span>{" "}
                        {info.hygienists.map((c, i) => {
                          const isMatch = c.id === highlightId;
                          return (
                            <span key={i}>
                              {i > 0 && <span className="text-slate-400">/</span>}
                              <span
                                className={c.name === "???" ? chipClass(isMatch, "text-amber-600 font-bold") : chipClass(isMatch, "text-slate-600 font-medium")}
                                style={dimStyle(isMatch)}
                              >
                                {c.name}
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    )}
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
    </div>
  );
}
