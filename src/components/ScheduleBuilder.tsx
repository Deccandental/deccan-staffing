"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { loadStaff, loadPrefs, DentistPrefs } from "@/lib/staffStore";
import { buildDailyAssignments } from "@/lib/assignmentEngine";
import { generateMonth, formatMonthYear } from "@/utils/calendar";
import { getWeekday } from "@/lib/dateUtils";
import { getOverrides, StaffOverride } from "@/lib/overrides";
import { getOpenTuesdays, OpenTuesday } from "@/lib/openTuesdays";
import { loadSchedule, saveDaySchedule, MonthSchedule, AssistantOverrides } from "@/lib/scheduleStore";
import { resolveDentistAssistants, getDentistSlotOverrides } from "@/lib/assistantSlots";
import { loadHolidays, Holiday } from "@/lib/holidays";
import { Employee } from "@/types/employee";
import { TempAssignment, getTempAssignmentsForMonth } from "@/lib/tempAssignments";
import { TempStaff } from "@/app/temps/page";
import { supabase } from "@/lib/supabase";
import MonthlyOverview, { DayAssignmentSummary } from "./MonthlyOverview";
import DailyAssignmentPanel from "./DailyAssignmentPanel";
import PrintSchedule from "./PrintSchedule";
import PrintIndividualSchedule from "./PrintIndividualSchedule";

type View = "build" | "review";

async function loadTemps(): Promise<TempStaff[]> {
  const { data, error } = await supabase.from("temps").select("*");
  if (error) { console.error("loadTemps error:", error); return []; }
  return (data ?? []).map((row) => ({
    id: row.id, name: row.name, phone: row.phone ?? "", email: row.email ?? "",
    role: row.role, skills: row.skills ?? [], rating: row.rating ?? 0,
    notes: row.notes ?? "", addedAt: row.added_at,
  }));
}

export default function ScheduleBuilder() {
  const today = new Date();
  const [view, setView] = useState<View>(() => {
    if (typeof window === "undefined") return "build";
    const params = new URLSearchParams(window.location.search);
    return params.get("view") === "review" ? "review" : "build";
  });
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [overrides, setOverrides] = useState<StaffOverride[]>([]);
  const [prefs, setPrefs] = useState<DentistPrefs>({});
  const [openTuesdays, setOpenTuesdays] = useState<OpenTuesday[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [schedule, setSchedule] = useState<MonthSchedule>({});
  const [loadedYearMonth, setLoadedYearMonth] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const [temps, setTemps] = useState<TempStaff[]>([]);
  const [monthTempAssignments, setMonthTempAssignments] = useState<TempAssignment[]>([]);

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
      setStaffLoaded(true);
    }
    load();

    async function handleVisibility() {
      if (document.visibilityState === "visible") {
        const [o, ot, h, t] = await Promise.all([getOverrides(), getOpenTuesdays(), loadHolidays(), loadTemps()]);
        setOverrides(o);
        setOpenTuesdays(ot);
        setHolidays(h);
        setTemps(t);
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    async function load() {
      const [saved, ta] = await Promise.all([
        loadSchedule(year, month),
        getTempAssignmentsForMonth(year, month),
      ]);
      setSchedule(saved);
      setMonthTempAssignments(ta);
      setLoadedYearMonth(`${year}-${month}`);
    }
    load();
  }, [year, month]);

  const openDays = generateMonth(year, month, openTuesdays, holidays).filter((d) => d.isOpen);
  // True only once the schedule actually loaded from the DB matches the
  // year/month currently being viewed. Computed at render time (not set
  // inside an effect) so it can't be one render-cycle stale relative to a
  // sibling effect that also reads it in the same commit.
  const scheduleLoaded = loadedYearMonth === `${year}-${month}`;

  async function applyDefaults() {
    const filled: MonthSchedule = { ...schedule };
    const toSave: { date: string; dentists: string[]; frontDeskRequired: number; hygienistsRequired: number }[] = [];
    for (const day of openDays) {
      if (!filled[day.date]) {
        const dowKey = getWeekday(day.date);
        const dentists = staff
          .filter((e) => e.role === "Dentist" && (day.isOpenTuesday || e.defaultSchedule[dowKey]))
          .map((e) => e.name);
        filled[day.date] = { dentists, frontDeskRequired: 2, hygienistsRequired: 1, assistantOverrides: {}, hygienistOverrides: {}, assistantCounts: {}, floaterAssistantId: null };
        toSave.push({ date: day.date, dentists, frontDeskRequired: 2, hygienistsRequired: 1 });
      }
    }
    setSchedule(filled);
    setSaving(true);
    await Promise.all(toSave.map(({ date, dentists, frontDeskRequired, hygienistsRequired }) =>
      saveDaySchedule(date, dentists, frontDeskRequired, hygienistsRequired, {})
    ));
    setSaving(false);
  }

  // Auto-fill default assignments for any open day in the current month that
  // genuinely has no saved schedule entry — replaces the old "Pick Month" /
  // "Mark Absences" intro steps. Gated on scheduleLoaded (the real DB load
  // for this exact year/month having finished) so this never mistakes "not
  // loaded yet" for "never configured" and overwrites saved selections.
  const defaultsAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${year}-${month}`;
    if (!scheduleLoaded || openDays.length === 0 || staff.length === 0) return;
    if (defaultsAppliedRef.current === key) return;
    defaultsAppliedRef.current = key;
    const hasMissingDay = openDays.some((d) => !schedule[d.date]);
    if (hasMissingDay) applyDefaults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleLoaded, year, month]);

  async function handleSelectDate(date: string) {
    setSelectedDate(date);
    if (!schedule[date]) {
      const dowKey = getWeekday(date);
      const day = openDays.find((d) => d.date === date);
      const dentists = staff
        .filter((e) => e.role === "Dentist" && (day?.isOpenTuesday || e.defaultSchedule[dowKey]))
        .map((e) => e.name);
      setSchedule((c) => ({ ...c, [date]: { dentists, frontDeskRequired: 2, hygienistsRequired: 1, assistantOverrides: {}, hygienistOverrides: {}, assistantCounts: {}, floaterAssistantId: null } }));
      await saveDaySchedule(date, dentists, 2, 1, {});
    }
  }

  async function setWorkingDentists(dentists: string[]) {
    if (!selectedDate) return;
    const fdr = schedule[selectedDate]?.frontDeskRequired ?? 2;
    const hr = schedule[selectedDate]?.hygienistsRequired ?? 1;
    const ao = schedule[selectedDate]?.assistantOverrides ?? {};
    const ho = schedule[selectedDate]?.hygienistOverrides ?? {};
    const ac = schedule[selectedDate]?.assistantCounts ?? {};
    const fl = schedule[selectedDate]?.floaterAssistantId ?? null;
    setSchedule((c) => ({ ...c, [selectedDate]: { dentists, frontDeskRequired: fdr, hygienistsRequired: hr, assistantOverrides: ao, hygienistOverrides: ho, assistantCounts: ac, floaterAssistantId: fl } }));
    setSaving(true);
    await saveDaySchedule(selectedDate, dentists, fdr, hr, ao, ho, ac, fl);
    setSaving(false);
  }

  async function setFrontDeskRequired(required: number) {
    if (!selectedDate) return;
    const dentists = schedule[selectedDate]?.dentists ?? [];
    const hr = schedule[selectedDate]?.hygienistsRequired ?? 1;
    const ao = schedule[selectedDate]?.assistantOverrides ?? {};
    const ho = schedule[selectedDate]?.hygienistOverrides ?? {};
    const ac = schedule[selectedDate]?.assistantCounts ?? {};
    const fl = schedule[selectedDate]?.floaterAssistantId ?? null;
    setSchedule((c) => ({ ...c, [selectedDate]: { dentists, frontDeskRequired: required, hygienistsRequired: hr, assistantOverrides: ao, hygienistOverrides: ho, assistantCounts: ac, floaterAssistantId: fl } }));
    setSaving(true);
    await saveDaySchedule(selectedDate, dentists, required, hr, ao, ho, ac, fl);
    setSaving(false);
  }

  async function setHygienistsRequired(required: number) {
    if (!selectedDate) return;
    const dentists = schedule[selectedDate]?.dentists ?? [];
    const fdr = schedule[selectedDate]?.frontDeskRequired ?? 2;
    const ao = schedule[selectedDate]?.assistantOverrides ?? {};
    const ho = schedule[selectedDate]?.hygienistOverrides ?? {};
    const ac = schedule[selectedDate]?.assistantCounts ?? {};
    const fl = schedule[selectedDate]?.floaterAssistantId ?? null;
    setSchedule((c) => ({ ...c, [selectedDate]: { dentists, frontDeskRequired: fdr, hygienistsRequired: required, assistantOverrides: ao, hygienistOverrides: ho, assistantCounts: ac, floaterAssistantId: fl } }));
    setSaving(true);
    await saveDaySchedule(selectedDate, dentists, fdr, required, ao, ho, ac, fl);
    setSaving(false);
  }

  async function handleAssistantOverrideChange(overridesMap: AssistantOverrides) {
    if (!selectedDate) return;
    const dentists = schedule[selectedDate]?.dentists ?? [];
    const fdr = schedule[selectedDate]?.frontDeskRequired ?? 2;
    const hr = schedule[selectedDate]?.hygienistsRequired ?? 1;
    const ho = schedule[selectedDate]?.hygienistOverrides ?? {};
    const ac = schedule[selectedDate]?.assistantCounts ?? {};
    const fl = schedule[selectedDate]?.floaterAssistantId ?? null;
    setSchedule((c) => ({ ...c, [selectedDate]: { dentists, frontDeskRequired: fdr, hygienistsRequired: hr, assistantOverrides: overridesMap, hygienistOverrides: ho, assistantCounts: ac, floaterAssistantId: fl } }));
    setSaving(true);
    await saveDaySchedule(selectedDate, dentists, fdr, hr, overridesMap, ho, ac, fl);
    setSaving(false);
  }

  async function handleHygienistOverrideChange(overridesMap: Record<number, number | null>) {
    if (!selectedDate) return;
    const dentists = schedule[selectedDate]?.dentists ?? [];
    const fdr = schedule[selectedDate]?.frontDeskRequired ?? 2;
    const hr = schedule[selectedDate]?.hygienistsRequired ?? 1;
    const ao = schedule[selectedDate]?.assistantOverrides ?? {};
    const ac = schedule[selectedDate]?.assistantCounts ?? {};
    const fl = schedule[selectedDate]?.floaterAssistantId ?? null;
    setSchedule((c) => ({ ...c, [selectedDate]: { dentists, frontDeskRequired: fdr, hygienistsRequired: hr, assistantOverrides: ao, hygienistOverrides: overridesMap, assistantCounts: ac, floaterAssistantId: fl } }));
    setSaving(true);
    await saveDaySchedule(selectedDate, dentists, fdr, hr, ao, overridesMap, ac, fl);
    setSaving(false);
  }

  // Sets how many assistants a specific dentist needs today (default 1).
  // Trims any now out-of-range slot overrides for that dentist so a stale
  // override (e.g. slot 2's override after dropping the count to 1) can't
  // silently resurface if the count is raised again later.
  async function handleAssistantCountChange(dentistId: number, count: number) {
    if (!selectedDate) return;
    const dentists = schedule[selectedDate]?.dentists ?? [];
    const fdr = schedule[selectedDate]?.frontDeskRequired ?? 2;
    const hr = schedule[selectedDate]?.hygienistsRequired ?? 1;
    const ho = schedule[selectedDate]?.hygienistOverrides ?? {};
    const ac = { ...(schedule[selectedDate]?.assistantCounts ?? {}), [dentistId]: count };
    const fl = schedule[selectedDate]?.floaterAssistantId ?? null;
    setSchedule((c) => ({ ...c, [selectedDate]: { dentists, frontDeskRequired: fdr, hygienistsRequired: hr, assistantOverrides: schedule[selectedDate]?.assistantOverrides ?? {}, hygienistOverrides: ho, assistantCounts: ac, floaterAssistantId: fl } }));
    setSaving(true);
    await saveDaySchedule(selectedDate, dentists, fdr, hr, schedule[selectedDate]?.assistantOverrides ?? {}, ho, ac, fl);
    setSaving(false);
  }

  // Sets (or clears) the day's Floater — one extra assistant added for the
  // day as a whole, independent of any dentist's own assistant count.
  async function handleFloaterChange(floaterAssistantId: number | null) {
    if (!selectedDate) return;
    const dentists = schedule[selectedDate]?.dentists ?? [];
    const fdr = schedule[selectedDate]?.frontDeskRequired ?? 2;
    const hr = schedule[selectedDate]?.hygienistsRequired ?? 1;
    const ao = schedule[selectedDate]?.assistantOverrides ?? {};
    const ho = schedule[selectedDate]?.hygienistOverrides ?? {};
    const ac = schedule[selectedDate]?.assistantCounts ?? {};
    setSchedule((c) => ({ ...c, [selectedDate]: { dentists, frontDeskRequired: fdr, hygienistsRequired: hr, assistantOverrides: ao, hygienistOverrides: ho, assistantCounts: ac, floaterAssistantId } }));
    setSaving(true);
    await saveDaySchedule(selectedDate, dentists, fdr, hr, ao, ho, ac, floaterAssistantId);
    setSaving(false);
  }

  function handleTempAssignmentsChange(date: string, updatedForDate: TempAssignment[]) {
    setMonthTempAssignments((c) => [...c.filter((ta) => ta.date !== date), ...updatedForDate]);
  }

  const dayStatuses = useMemo(() => {
    const statuses: Record<string, "complete" | "warning" | "empty"> = {};
    if (!staffLoaded || !scheduleLoaded) {
      for (const day of openDays) statuses[day.date] = "empty";
      return statuses;
    }
    for (const day of openDays) {
      const daySched = schedule[day.date];
      if (!daySched) { statuses[day.date] = "empty"; continue; }
      const assignments = buildDailyAssignments(
        staff, daySched.dentists, day.date, prefs, overrides,
        day.isTuesday && day.isOpenTuesday,
        daySched.frontDeskRequired ?? 2,
        daySched.hygienistsRequired ?? 1,
        daySched.assistantCounts ?? {},
        daySched.floaterAssistantId ?? null
      );
      if (assignments.warnings.some((w) => w.severity === "error")) {
        statuses[day.date] = "warning";
      } else if (assignments.warnings.length > 0) {
        statuses[day.date] = "warning";
      } else if (daySched.dentists.length > 0) {
        statuses[day.date] = "complete";
      } else {
        statuses[day.date] = "empty";
      }
    }
    return statuses;
  }, [schedule, staff, openDays, prefs, overrides]);

  const completedDays = Object.values(dayStatuses).filter((s) => s === "complete").length;
  const warningDays = Object.values(dayStatuses).filter((s) => s === "warning").length;
  const totalDays = openDays.length;

  const monthAssignments = useMemo(() => {
    const result: Record<string, DayAssignmentSummary> = {};
    for (const day of openDays) {
      const daySched = schedule[day.date];
      if (!daySched || daySched.dentists.length === 0) continue;

      const assignments = buildDailyAssignments(
        staff, daySched.dentists, day.date, prefs, overrides,
        day.isTuesday && day.isOpenTuesday,
        daySched.frontDeskRequired ?? 2,
        daySched.hygienistsRequired ?? 1,
        daySched.assistantCounts ?? {},
        daySched.floaterAssistantId ?? null
      );

      const tempsForDay = monthTempAssignments.filter((ta) => ta.date === day.date);
      const tempName = (tempId: string) => temps.find((t) => t.id === tempId)?.name ?? "Temp";

      const ao = daySched.assistantOverrides ?? {};
      const ac = daySched.assistantCounts ?? {};
      const floaterName = daySched.floaterAssistantId != null
        ? staff.find((e) => e.id === daySched.floaterAssistantId)?.name ?? null
        : null;
      const dentists = assignments.dentists.map(({ dentist, assistants }) => {
        const tempForDentist = tempsForDay.find(
          (ta) => ta.role === "Assistant" && ta.notes === `dentist:${dentist.id}`
        );
        if (tempForDentist) {
          return { id: dentist.id, name: dentist.name, color: dentist.color, assistantName: `${tempName(tempForDentist.tempId)} (temp)` };
        }
        const resolved = resolveDentistAssistants(dentist.id, assistants, ac, ao, staff).filter(Boolean) as Employee[];
        const assistantName = resolved.length > 0 ? resolved.map((a) => a.name).join(", ") : null;
        return { id: dentist.id, name: dentist.name, color: dentist.color, assistantName };
      });

      // Resolve hygienist slots, applying any manual swaps.
      const ho = daySched.hygienistOverrides ?? {};
      const hygSlotCount = daySched.hygienistsRequired ?? 1;
      const resolvedHygienists = Array.from({ length: hygSlotCount }, (_, i) => {
        if (i in ho) {
          const ovId = ho[i];
          return ovId != null ? staff.find((e) => e.id === ovId) ?? null : null;
        }
        return assignments.hygienists[i] ?? null;
      }).filter(Boolean) as Employee[];

      const tempFrontDesk = tempsForDay.filter((ta) => ta.role === "Front Desk").map((ta) => `${tempName(ta.tempId)} (temp)`);
      const tempHygienists = tempsForDay.filter((ta) => ta.role === "Hygienist").map((ta) => `${tempName(ta.tempId)} (temp)`);

      result[day.date] = {
        dentists,
        frontDesk: [...assignments.frontDesk.map((e) => e.name), ...tempFrontDesk],
        hygienists: [...resolvedHygienists.map((e) => e.name), ...tempHygienists],
        floater: floaterName,
      };
    }
    return result;
  }, [openDays, schedule, staff, prefs, overrides, monthTempAssignments, temps]);

  const allDentists = staff.filter((e) => e.role === "Dentist").map((e) => e.name);
  const workingDentists = selectedDate && schedule[selectedDate] ? schedule[selectedDate].dentists : [];
  const frontDeskRequired = selectedDate && schedule[selectedDate] ? (schedule[selectedDate].frontDeskRequired ?? 2) : 2;
  const hygienistsRequired = selectedDate && schedule[selectedDate] ? (schedule[selectedDate].hygienistsRequired ?? 1) : 1;
  const assistantOverrides = selectedDate && schedule[selectedDate] ? (schedule[selectedDate].assistantOverrides ?? {}) : {};
  const hygienistOverrides = selectedDate && schedule[selectedDate] ? (schedule[selectedDate].hygienistOverrides ?? {}) : {};
  const assistantCounts = selectedDate && schedule[selectedDate] ? (schedule[selectedDate].assistantCounts ?? {}) : {};
  const floaterAssistantId = selectedDate && schedule[selectedDate] ? (schedule[selectedDate].floaterAssistantId ?? null) : null;

  const selectedAssignments = useMemo(() => {
    if (!selectedDate) return undefined;
    const day = openDays.find((d) => d.date === selectedDate);
    const isOpenTuesday = day?.isTuesday && day?.isOpenTuesday ? true : false;
    const fdr = schedule[selectedDate]?.frontDeskRequired ?? 2;
    const hr = schedule[selectedDate]?.hygienistsRequired ?? 1;
    const ac = schedule[selectedDate]?.assistantCounts ?? {};
    const fl = schedule[selectedDate]?.floaterAssistantId ?? null;
    return buildDailyAssignments(staff, workingDentists, selectedDate, prefs, overrides, isOpenTuesday, fdr, hr, ac, fl);
  }, [staff, workingDentists, selectedDate, schedule, prefs, overrides, openDays]);

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1);
    setSchedule({}); setSelectedDate("");
  }

  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1);
    setSchedule({}); setSelectedDate("");
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-4 shadow flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={prevMonth} className="rounded-xl border px-3 py-1.5 text-slate-500 hover:bg-slate-50 transition">←</button>
          <span className="text-xl font-bold min-w-[180px] text-center">{formatMonthYear(year, month)}</span>
          <button onClick={nextMonth} className="rounded-xl border px-3 py-1.5 text-slate-500 hover:bg-slate-50 transition">→</button>
        </div>
        <div className="flex items-center gap-2">
          <a href="/availability" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">
            🏥 Mark Absences
          </a>
          <button onClick={() => setView("build")}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${view === "build" ? "bg-cyan-600 text-white shadow" : "text-cyan-600 hover:bg-cyan-50"}`}>
            📋 Build Schedule
          </button>
          <button onClick={() => setView("review")}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${view === "review" ? "bg-cyan-600 text-white shadow" : "text-cyan-600 hover:bg-cyan-50"}`}>
            🖨️ Review & Print
          </button>
        </div>
      </div>

      {view === "build" && (
        <div className="space-y-6">
          <div className="rounded-2xl bg-white p-5 shadow">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-sm text-slate-400">
                  {completedDays} of {totalDays} days complete
                  {warningDays > 0 && <span className="ml-2 text-amber-500">· {warningDays} with warnings</span>}
                </span>
                {saving && <span className="ml-3 text-xs text-cyan-500">💾 Saving...</span>}
              </div>
              <button onClick={applyDefaults} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition">↺ Re-apply Defaults</button>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${totalDays > 0 ? (completedDays / totalDays) * 100 : 0}%` }} />
            </div>
          </div>

          <MonthlyOverview year={year} month={month} dayStatuses={dayStatuses} selectedDate={selectedDate} onSelectDate={handleSelectDate} openTuesdays={openTuesdays} holidays={holidays} dayAssignments={monthAssignments} />

          {selectedDate ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl bg-white p-6 shadow">
                <h3 className="text-lg font-bold mb-1">
                  {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                </h3>
                <p className="text-sm text-slate-400 mb-4">Select which dentists are working today</p>

                <div className="mb-3 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-600">Front Desk Required</div>
                    <div className="text-xs text-slate-400">How many front desk staff needed today</div>
                  </div>
                  <div className="flex gap-2">
                    {[1, 2, 3].map((n) => (
                      <button key={n} onClick={() => setFrontDeskRequired(n)}
                        className="rounded-lg px-4 py-1.5 text-sm font-semibold transition"
                        style={frontDeskRequired === n ? { backgroundColor: "#e8622a", color: "white" } : { background: "white", color: "#6b7280", border: "1px solid #e5e7eb" }}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-4 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-600">Hygienists Required</div>
                    <div className="text-xs text-slate-400">How many hygienists needed today</div>
                  </div>
                  <div className="flex gap-2">
                    {[0, 1, 2].map((n) => (
                      <button key={n} onClick={() => setHygienistsRequired(n)}
                        className="rounded-lg px-4 py-1.5 text-sm font-semibold transition"
                        style={hygienistsRequired === n ? { backgroundColor: "#059669", color: "white" } : { background: "white", color: "#6b7280", border: "1px solid #e5e7eb" }}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
                  👥 {workingDentists.length} dentist{workingDentists.length !== 1 ? "s" : ""} selected
                  {saving && <span className="ml-2 text-cyan-500">💾 Saving...</span>}
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {allDentists.map((name) => {
                    const checked = workingDentists.includes(name);
                    const emp = staff.find((e) => e.name === name);
                    const dowKey = selectedDate ? getWeekday(selectedDate) : null;
                    const day = openDays.find((d) => d.date === selectedDate);
                    const worksToday = emp && dowKey ? (day?.isOpenTuesday ? true : emp.defaultSchedule[dowKey]) : true;
                    const hasOverride = emp ? overrides.some((o) => o.employeeId === emp.id && o.date === selectedDate && !o.halfDay && o.reason !== "remote") : false;
                    const unavailable = !worksToday || hasOverride;
                    return (
                      <button key={name}
                        onClick={() => { if (unavailable) return; setWorkingDentists(checked ? workingDentists.filter((d) => d !== name) : [...workingDentists, name]); }}
                        className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                          unavailable ? "border-red-100 bg-red-50 opacity-60 cursor-not-allowed"
                          : checked ? "border-orange-400 bg-orange-50"
                          : "border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: emp?.color ?? "#888" }} />
                        <span className="text-sm font-medium">{name}</span>
                        {unavailable ? (
                          <span className="ml-auto text-xs text-red-400 font-medium">Unavailable</span>
                        ) : (
                          <span className={`ml-auto h-4 w-4 rounded border flex items-center justify-center text-xs ${checked ? "text-white" : "border-slate-300"}`} style={checked ? { backgroundColor: "#e8622a", borderColor: "#e8622a" } : {}}>
                            {checked ? "✓" : ""}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <DailyAssignmentPanel
                key={selectedDate}
                selectedDate={selectedDate}
                assignments={selectedAssignments}
                assistantOverrides={assistantOverrides}
                onOverrideChange={handleAssistantOverrideChange}
                assistantCounts={assistantCounts}
                onAssistantCountChange={handleAssistantCountChange}
                floaterAssistantId={floaterAssistantId}
                onFloaterChange={handleFloaterChange}
                hygienistsRequired={hygienistsRequired}
                hygienistOverrides={hygienistOverrides}
                onHygienistOverrideChange={handleHygienistOverrideChange}
                onTempAssignmentsChange={handleTempAssignmentsChange}
                frontDeskRequired={frontDeskRequired}
              />
            </div>
          ) : (
            <div className="rounded-2xl bg-white p-8 text-center shadow">
              <p className="text-slate-400">← Select a day from the calendar above to edit staffing</p>
            </div>
          )}
        </div>
      )}

      {view === "review" && (
        <div className="space-y-6">
          <div className="rounded-2xl bg-white p-6 shadow">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-2xl font-bold">{formatMonthYear(year, month)} — Schedule Review</h2>
                <p className="text-slate-500 mt-1">{completedDays} of {totalDays} days fully staffed{warningDays > 0 ? ` · ${warningDays} days have warnings` : ""}</p>
              </div>
              <PrintSchedule year={year} month={month} schedule={schedule} />
              <PrintIndividualSchedule year={year} month={month} schedule={schedule} />
            </div>
            {warningDays > 0 && (
              <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-4">
                <p className="text-sm text-amber-700">⚠️ Some days have staffing warnings. <button onClick={() => setView("build")} className="underline font-semibold">Go back to fix them</button>.</p>
              </div>
            )}
          </div>

          <MonthlyOverview
            year={year}
            month={month}
            dayStatuses={dayStatuses}
            selectedDate={selectedDate}
            onSelectDate={(date) => { handleSelectDate(date); setView("build"); }}
            openTuesdays={openTuesdays}
            holidays={holidays}
            dayAssignments={monthAssignments}
          />

          <div className="rounded-2xl bg-white shadow overflow-hidden">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b">
                  <th className="p-4 text-left font-semibold text-slate-500 w-40">Date</th>
                  <th className="p-4 text-left font-semibold text-slate-500">Dentist / Assistant</th>
                  <th className="p-4 text-left font-semibold text-slate-500 w-36">Front Desk</th>
                  <th className="p-4 text-left font-semibold text-slate-500 w-32">Hygienist</th>
                  <th className="p-4 text-left font-semibold text-slate-500 w-24">Status</th>
                </tr>
              </thead>
              <tbody>
                {openDays.map((day) => {
                  const daySched = schedule[day.date];
                  const assignments = daySched ? buildDailyAssignments(
                    staff, daySched.dentists, day.date, prefs, overrides,
                    day.isTuesday && day.isOpenTuesday,
                    daySched.frontDeskRequired ?? 2,
                    daySched.hygienistsRequired ?? 1,
                    daySched.assistantCounts ?? {},
                    daySched.floaterAssistantId ?? null
                  ) : null;

                  const ao = daySched?.assistantOverrides ?? {};
                  const ac = daySched?.assistantCounts ?? {};
                  const floaterName = daySched?.floaterAssistantId != null
                    ? staff.find((e) => e.id === daySched.floaterAssistantId)?.name ?? null
                    : null;
                  const resolvedDentists = assignments?.dentists.map(({ dentist, assistants }) => {
                    const resolved = resolveDentistAssistants(dentist.id, assistants, ac, ao, staff).filter(Boolean) as Employee[];
                    return { dentist, assistants: resolved };
                  });

                  const ho = daySched?.hygienistOverrides ?? {};
                  const hygSlotCount = daySched?.hygienistsRequired ?? 1;
                  const resolvedHygienists = assignments ? Array.from({ length: hygSlotCount }, (_, i) => {
                    if (i in ho) {
                      const ovId = ho[i];
                      return ovId != null ? staff.find((e) => e.id === ovId) ?? null : null;
                    }
                    return assignments.hygienists[i] ?? null;
                  }).filter(Boolean) as Employee[] : [];

                  const status = dayStatuses[day.date];
                  const dateLabel = new Date(day.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                  return (
                    <tr key={day.date} className="border-b hover:bg-slate-50 cursor-pointer" onClick={() => { handleSelectDate(day.date); setView("build"); }}>
                      <td className="p-4 font-medium">
                        {dateLabel}
                        {day.isTuesday && <span className="ml-2 rounded-full bg-blue-100 text-blue-600 text-xs px-1.5 py-0.5">Tue</span>}
                        {day.isHoliday && <span className="ml-2 rounded-full bg-red-100 text-red-600 text-xs px-1.5 py-0.5">{day.holidayName}</span>}
                      </td>
                      <td className="p-4">
                        {resolvedDentists?.map(({ dentist, assistants }) => (
                          <div key={dentist.id} className="flex items-center gap-1.5 text-xs mb-0.5">
                            <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: dentist.color }} />
                            <span className="font-medium">{dentist.name}</span>
                            <span className="text-slate-400">/ {assistants.length > 0 ? assistants.map((a) => a.name).join(", ") : "No Assistant"}</span>
                            {Object.keys(getDentistSlotOverrides(ao, dentist.id)).length > 0 && <span className="text-cyan-400 text-xs">(manual)</span>}
                          </div>
                        )) ?? <span className="text-slate-300 text-xs">Not configured</span>}
                        {floaterName && (
                          <div className="flex items-center gap-1.5 text-xs mt-0.5">
                            <span className="h-1.5 w-1.5 rounded-full flex-shrink-0 bg-slate-400" />
                            <span className="text-slate-400">Floater: <span className="font-medium text-slate-600">{floaterName}</span></span>
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-xs text-slate-600">
                        {assignments?.frontDesk.map((e) => e.name).join(", ") ?? "—"}
                        {daySched?.frontDeskRequired === 1 && <span className="ml-1 text-orange-400">(1 req.)</span>}
                      </td>
                      <td className="p-4 text-xs text-slate-600">
                        {assignments ? (resolvedHygienists.map((e) => e.name).join(", ") || "—") : "—"}
                        {daySched?.hygienistsRequired === 0 && <span className="ml-1 text-slate-400">(none req.)</span>}
                        {daySched?.hygienistsRequired === 2 && <span className="ml-1 text-emerald-500">(2 req.)</span>}
                      </td>
                      <td className="p-4">
                        {status === "complete" && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">✓ Ready</span>}
                        {status === "warning" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">⚠ Warning</span>}
                        {status === "empty" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-400">Not set</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setView("build")} className="rounded-xl border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">← Back to Edit</button>
            <PrintSchedule year={year} month={month} schedule={schedule} />
            <PrintIndividualSchedule year={year} month={month} schedule={schedule} />
          </div>
        </div>
      )}
    </div>
  );
}
