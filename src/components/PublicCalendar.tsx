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
import { DayAssignmentSummary } from "./MonthlyOverview";
import PrintSchedule from "./PrintSchedule";
import PrintIndividualScheduleCalendar from "./PrintIndividualScheduleCalendar";

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
  const [viewMode, setViewMode] = useState<"all" | "individual">("all");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);

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
    const result: Record<string, DayAssignmentSummary> = {};
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
      const dentists = assignments.dentists.map(({ dentist, assistant }) => {
        const tempForDentist = tempsForDay.find(
          (ta) => ta.role === "Assistant" && ta.notes === `dentist:${dentist.id}`
        );
        if (tempForDentist) {
          return { id: dentist.id, name: dentist.name, color: dentist.color, assistantName: `${tempName(tempForDentist.tempId)} (temp)` };
        }
        let resolvedAssistant = assistant;
        if (dentist.id in ao) {
          const ovId = ao[dentist.id];
          resolvedAssistant = ovId != null ? staff.find((e) => e.id === ovId) ?? null : null;
        }
        return { id: dentist.id, name: dentist.name, color: dentist.color, assistantName: resolvedAssistant ? firstName(resolvedAssistant.name) : "???" };
      });

      const tempFrontDesk = tempsForDay.filter((ta) => ta.role === "Front Desk").map((ta) => `${tempName(ta.tempId)} (temp)`);
      const tempHygienists = tempsForDay.filter((ta) => ta.role === "Hygienist").map((ta) => `${tempName(ta.tempId)} (temp)`);

      const frontDesk = [...assignments.frontDesk.map((e) => firstName(e.name)), ...tempFrontDesk];
      const hygienists = [...assignments.hygienists.map((e) => firstName(e.name)), ...tempHygienists];

      result[day.date] = {
        dentists,
        frontDesk: frontDesk.length > 0 ? frontDesk : frontDeskRequired > 0 ? ["???"] : [],
        hygienists: hygienists.length > 0 ? hygienists : hygienistsRequired > 0 ? ["???"] : [],
      };
    }
    return result;
  }, [days, schedule, staff, prefs, overrides, monthTempAssignments, temps]);

  const ROLE_GROUPS = [
    { label: "Dentists", roles: ["Dentist"] },
    { label: "Assistants & RDAs", roles: ["Assistant", "RDA"] },
    { label: "Front Desk", roles: ["Front Desk"] },
    { label: "Hygienists", roles: ["Hygienist"] },
  ] as const;

  const individualAssignments = useMemo(() => {
    const result: Record<string, { role: string; detail: string } | null> = {};
    if (!selectedEmployeeId) return result;
    const emp = staff.find((e) => e.id === selectedEmployeeId);
    if (!emp) return result;
    const firstName = (name: string) => name.split(" ")[0];

    for (const day of days) {
      if (!day.isOpen) continue;
      const daySched = schedule[day.date];
      if (!daySched) { result[day.date] = null; continue; }

      const assignments = buildDailyAssignments(
        staff, daySched.dentists, day.date, prefs, overrides,
        day.isTuesday && day.isOpenTuesday,
        daySched.frontDeskRequired ?? 2,
        daySched.hygienistsRequired ?? 1
      );
      const ao = daySched.assistantOverrides ?? {};
      const tempsForDay = monthTempAssignments.filter((ta) => ta.date === day.date);
      const tempName = (tempId: string) => firstName(temps.find((t) => t.id === tempId)?.name ?? "Temp");

      let info: { role: string; detail: string } | null = null;

      if (emp.role === "Dentist") {
        const pair = assignments.dentists.find((d) => d.dentist.id === emp.id);
        if (pair) {
          let assistantName = pair.assistant?.name ? firstName(pair.assistant.name) : null;
          if (pair.dentist.id in ao) {
            const ovId = ao[pair.dentist.id];
            assistantName = ovId != null ? staff.find((e) => e.id === ovId)?.name ?? null : null;
            if (assistantName) assistantName = firstName(assistantName);
          }
          const tempForDentist = tempsForDay.find((ta) => ta.role === "Assistant" && ta.notes === `dentist:${pair.dentist.id}`);
          if (tempForDentist) assistantName = `${tempName(tempForDentist.tempId)} (temp)`;
          info = { role: "Dentist", detail: assistantName ? `w/ ${assistantName}` : "No assistant" };
        }
      }

      if (!info && (emp.skills.includes("Assistant") || emp.role === "RDA")) {
        const directPair = assignments.dentists.find((d) => {
          if (d.dentist.id in ao) {
            const ovId = ao[d.dentist.id];
            return ovId === emp.id;
          }
          return d.assistant?.id === emp.id;
        });
        if (directPair) info = { role: "Assistant", detail: `w/ ${directPair.dentist.name}` };
        else if (assignments.frontDesk.find((e) => e.id === emp.id)) info = { role: "Front Desk", detail: "" };
      }

      if (!info && emp.role === "Front Desk" && assignments.frontDesk.find((e) => e.id === emp.id)) {
        info = { role: "Front Desk", detail: "" };
      }

      if (!info && (emp.role === "Hygienist" || emp.skills.includes("Hygienist")) && assignments.hygienists.find((e) => e.id === emp.id)) {
        info = { role: "Hygienist", detail: "" };
      }

      result[day.date] = info;
    }
    return result;
  }, [selectedEmployeeId, days, schedule, staff, prefs, overrides, monthTempAssignments, temps]);

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1);
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
        <div className="flex items-center gap-2">
          <button onClick={() => setViewMode("all")}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${viewMode === "all" ? "bg-cyan-600 text-white shadow" : "text-cyan-600 hover:bg-cyan-50"}`}>
            👥 All Staff
          </button>
          <button onClick={() => setViewMode("individual")}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${viewMode === "individual" ? "bg-cyan-600 text-white shadow" : "text-cyan-600 hover:bg-cyan-50"}`}>
            👤 By Person
          </button>
        </div>
        {viewMode === "individual" && (
          <select
            value={selectedEmployeeId ?? ""}
            onChange={(e) => setSelectedEmployeeId(e.target.value ? Number(e.target.value) : null)}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium focus:outline-none"
          >
            <option value="">Select a staff member…</option>
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
            const indInfo = viewMode === "individual" ? individualAssignments[day.date] : undefined;
            const selectedEmployee = staff.find((e) => e.id === selectedEmployeeId) ?? null;

            if (!day.isOpen) {
              return (
                <div key={day.date} className="rounded-xl p-3 text-center select-none min-h-[110px] sm:min-h-[140px] flex flex-col"
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
                className={`rounded-xl border-2 p-3 text-left min-h-[110px] sm:min-h-[140px] flex flex-col ${borderColor} ${bgColor}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`text-sm font-medium ${isToday ? "text-cyan-600" : isOpenTue ? "text-blue-400" : "text-slate-400"}`}>{day.weekday}</span>
                  <span className={`text-xl font-bold ${isToday ? "text-cyan-600" : "text-slate-700"}`}>{day.day}</span>
                </div>

                {viewMode === "individual" ? (
                  !selectedEmployee ? (
                    <div className="flex-1 flex items-center">
                      <span className="text-sm text-slate-300">Select a staff member</span>
                    </div>
                  ) : indInfo ? (
                    <div className="flex-1 flex flex-col justify-center items-center text-center gap-1">
                      <span className="rounded-lg px-2 py-1 text-sm font-bold" style={{ backgroundColor: `${selectedEmployee.color}22`, color: selectedEmployee.color }}>
                        {indInfo.role}
                      </span>
                      {indInfo.detail && <span className="text-sm font-semibold text-slate-600">{indInfo.detail}</span>}
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center">
                      <span className="text-sm font-medium text-slate-300">Off</span>
                    </div>
                  )
                ) : info ? (
                  <div className="space-y-1 overflow-hidden">
                    {info.dentists.map((d) => (
                      <div key={d.id} className="text-sm leading-snug">
                        <span className="font-bold" style={{ color: d.color }}>{d.name}</span>
                        <span className={d.assistantName === "???" ? "text-amber-600 font-bold" : "text-slate-600 font-medium"}>/{d.assistantName}</span>
                      </div>
                    ))}
                    {info.frontDesk.length > 0 && (
                      <div className="text-sm leading-snug">
                        <span className="font-bold text-sky-600">Front:</span>{" "}
                        {info.frontDesk.map((name, i) => (
                          <span key={i}>
                            {i > 0 && <span className="text-slate-400">/</span>}
                            <span className={name === "???" ? "text-amber-600 font-bold" : "text-slate-600 font-medium"}>{name}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {info.hygienists.length > 0 && (
                      <div className="text-sm leading-snug">
                        <span className="font-bold text-emerald-600">Hyg:</span>{" "}
                        {info.hygienists.map((name, i) => (
                          <span key={i}>
                            {i > 0 && <span className="text-slate-400">/</span>}
                            <span className={name === "???" ? "text-amber-600 font-bold" : "text-slate-600 font-medium"}>{name}</span>
                          </span>
                        ))}
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
