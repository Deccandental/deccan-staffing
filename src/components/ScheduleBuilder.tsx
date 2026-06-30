"use client";

import { useState, useEffect, useMemo } from "react";
import { loadStaff, loadPrefs, DentistPrefs } from "@/lib/staffStore";
import { buildDailyAssignments } from "@/lib/assignmentEngine";
import { generateMonth, formatMonthYear } from "@/utils/calendar";
import { getWeekday } from "@/lib/dateUtils";
import { getOverrides, StaffOverride } from "@/lib/overrides";
import { getOpenTuesdays, OpenTuesday } from "@/lib/openTuesdays";
import { loadSchedule, saveDaySchedule, MonthSchedule } from "@/lib/scheduleStore";
import { loadHolidays, Holiday } from "@/lib/holidays";
import { Employee } from "@/types/employee";
import MonthlyOverview from "./MonthlyOverview";
import DailyAssignmentPanel from "./DailyAssignmentPanel";
import PrintSchedule from "./PrintSchedule";
import PrintIndividualSchedule from "./PrintIndividualSchedule";

const STEPS = [
  { id: 1, label: "Pick Month", icon: "📅" },
  { id: 2, label: "Mark Absences", icon: "🏥" },
  { id: 3, label: "Build Schedule", icon: "📋" },
  { id: 4, label: "Review & Print", icon: "🖨️" },
];

export default function ScheduleBuilder() {
  const today = new Date();
  const [step, setStep] = useState(() => {
    if (typeof window === "undefined") return 1;
    const params = new URLSearchParams(window.location.search);
    return Number(params.get("step") ?? "1");
  });
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [overrides, setOverrides] = useState<StaffOverride[]>([]);
  const [prefs, setPrefs] = useState<DentistPrefs>({});
  const [openTuesdays, setOpenTuesdays] = useState<OpenTuesday[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [schedule, setSchedule] = useState<MonthSchedule>({});
  const [selectedDate, setSelectedDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const [s, o, p, ot, h] = await Promise.all([
        loadStaff(), getOverrides(), loadPrefs(), getOpenTuesdays(), loadHolidays()
      ]);
      setStaff(s);
      setOverrides(o);
      setPrefs(p);
      setOpenTuesdays(ot);
      setHolidays(h);
    }
    load();

    async function handleVisibility() {
      if (document.visibilityState === "visible") {
        const [o, ot, h] = await Promise.all([getOverrides(), getOpenTuesdays(), loadHolidays()]);
        setOverrides(o);
        setOpenTuesdays(ot);
        setHolidays(h);
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    async function load() {
      const saved = await loadSchedule(year, month);
      setSchedule(saved);
    }
    load();
  }, [year, month]);

  const openDays = generateMonth(year, month, openTuesdays, holidays).filter((d) => d.isOpen);

  async function applyDefaults() {
    const filled: MonthSchedule = { ...schedule };
    const toSave: { date: string; dentists: string[]; frontDeskRequired: number; hygienistsRequired: number }[] = [];
    for (const day of openDays) {
      if (!filled[day.date]) {
        const dowKey = getWeekday(day.date);
        const dentists = staff
          .filter((e) => e.role === "Dentist" && (day.isOpenTuesday || e.defaultSchedule[dowKey]))
          .map((e) => e.name);
        filled[day.date] = { dentists, frontDeskRequired: 2, hygienistsRequired: 1, assistantOverrides: {} };
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

  async function handleSelectDate(date: string) {
    setSelectedDate(date);
    if (!schedule[date]) {
      const dowKey = getWeekday(date);
      const day = openDays.find((d) => d.date === date);
      const dentists = staff
        .filter((e) => e.role === "Dentist" && (day?.isOpenTuesday || e.defaultSchedule[dowKey]))
        .map((e) => e.name);
      setSchedule((c) => ({ ...c, [date]: { dentists, frontDeskRequired: 2, hygienistsRequired: 1, assistantOverrides: {} } }));
      await saveDaySchedule(date, dentists, 2, 1, {});
    }
  }

  async function setWorkingDentists(dentists: string[]) {
    if (!selectedDate) return;
    const fdr = schedule[selectedDate]?.frontDeskRequired ?? 2;
    const hr = schedule[selectedDate]?.hygienistsRequired ?? 1;
    const ao = schedule[selectedDate]?.assistantOverrides ?? {};
    setSchedule((c) => ({ ...c, [selectedDate]: { dentists, frontDeskRequired: fdr, hygienistsRequired: hr, assistantOverrides: ao } }));
    setSaving(true);
    await saveDaySchedule(selectedDate, dentists, fdr, hr, ao);
    setSaving(false);
  }

  async function setFrontDeskRequired(required: number) {
    if (!selectedDate) return;
    const dentists = schedule[selectedDate]?.dentists ?? [];
    const hr = schedule[selectedDate]?.hygienistsRequired ?? 1;
    const ao = schedule[selectedDate]?.assistantOverrides ?? {};
    setSchedule((c) => ({ ...c, [selectedDate]: { dentists, frontDeskRequired: required, hygienistsRequired: hr, assistantOverrides: ao } }));
    setSaving(true);
    await saveDaySchedule(selectedDate, dentists, required, hr, ao);
    setSaving(false);
  }

  async function setHygienistsRequired(required: number) {
    if (!selectedDate) return;
    const dentists = schedule[selectedDate]?.dentists ?? [];
    const fdr = schedule[selectedDate]?.frontDeskRequired ?? 2;
    const ao = schedule[selectedDate]?.assistantOverrides ?? {};
    setSchedule((c) => ({ ...c, [selectedDate]: { dentists, frontDeskRequired: fdr, hygienistsRequired: required, assistantOverrides: ao } }));
    setSaving(true);
    await saveDaySchedule(selectedDate, dentists, fdr, required, ao);
    setSaving(false);
  }

  async function handleAssistantOverrideChange(overridesMap: Record<number, number | null>) {
    if (!selectedDate) return;
    const dentists = schedule[selectedDate]?.dentists ?? [];
    const fdr = schedule[selectedDate]?.frontDeskRequired ?? 2;
    const hr = schedule[selectedDate]?.hygienistsRequired ?? 1;
    setSchedule((c) => ({ ...c, [selectedDate]: { dentists, frontDeskRequired: fdr, hygienistsRequired: hr, assistantOverrides: overridesMap } }));
    setSaving(true);
    await saveDaySchedule(selectedDate, dentists, fdr, hr, overridesMap);
    setSaving(false);
  }

  const dayStatuses = useMemo(() => {
    const statuses: Record<string, "complete" | "warning" | "empty"> = {};
    for (const day of openDays) {
      const daySched = schedule[day.date];
      if (!daySched) { statuses[day.date] = "empty"; continue; }
      const assignments = buildDailyAssignments(
        staff, daySched.dentists, day.date, prefs, overrides,
        day.isTuesday && day.isOpenTuesday,
        daySched.frontDeskRequired ?? 2,
        daySched.hygienistsRequired ?? 1
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

  const allDentists = staff.filter((e) => e.role === "Dentist").map((e) => e.name);
  const workingDentists = selectedDate && schedule[selectedDate] ? schedule[selectedDate].dentists : [];
  const frontDeskRequired = selectedDate && schedule[selectedDate] ? (schedule[selectedDate].frontDeskRequired ?? 2) : 2;
  const hygienistsRequired = selectedDate && schedule[selectedDate] ? (schedule[selectedDate].hygienistsRequired ?? 1) : 1;
  const assistantOverrides = selectedDate && schedule[selectedDate] ? (schedule[selectedDate].assistantOverrides ?? {}) : {};

  const selectedAssignments = useMemo(() => {
    if (!selectedDate) return undefined;
    const day = openDays.find((d) => d.date === selectedDate);
    const isOpenTuesday = day?.isTuesday && day?.isOpenTuesday ? true : false;
    const fdr = schedule[selectedDate]?.frontDeskRequired ?? 2;
    const hr = schedule[selectedDate]?.hygienistsRequired ?? 1;
    return buildDailyAssignments(staff, workingDentists, selectedDate, prefs, overrides, isOpenTuesday, fdr, hr);
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
      <div className="rounded-2xl bg-white p-4 shadow">
        <div className="flex items-center">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center flex-1">
              <button
                onClick={() => s.id <= step + 1 && setStep(s.id)}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                  step === s.id ? "bg-cyan-600 text-white shadow"
                  : s.id < step ? "text-cyan-600 hover:bg-cyan-50"
                  : "text-slate-300 cursor-not-allowed"
                }`}
              >
                <span>{s.icon}</span>
                <span>{s.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 rounded ${s.id < step ? "bg-cyan-400" : "bg-slate-200"}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {step === 1 && (
        <div className="rounded-2xl bg-white p-8 shadow">
          <h2 className="text-2xl font-bold mb-2">Which month are you scheduling?</h2>
          <p className="text-slate-500 mb-8">Select the month you want to build a schedule for.</p>
          <div className="flex items-center gap-4 mb-8">
            <button onClick={prevMonth} className="rounded-xl border px-4 py-2 text-slate-500 hover:bg-slate-50 transition">←</button>
            <span className="text-3xl font-bold min-w-[220px] text-center">{formatMonthYear(year, month)}</span>
            <button onClick={nextMonth} className="rounded-xl border px-4 py-2 text-slate-500 hover:bg-slate-50 transition">→</button>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 mb-8">
            <p className="text-sm text-slate-500">{totalDays} working days in {formatMonthYear(year, month)}</p>
          </div>
          <button onClick={() => { applyDefaults(); setStep(2); }} className="rounded-xl bg-cyan-600 px-8 py-3 font-semibold text-white hover:bg-cyan-700 transition">
            Continue to Mark Absences →
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="rounded-2xl bg-white p-8 shadow">
          <h2 className="text-2xl font-bold mb-2">Mark staff absences</h2>
          <p className="text-slate-500 mb-6">Go to the <strong>Availability</strong> page to mark sick days, PTO, and leave for {formatMonthYear(year, month)}. Come back here when done.</p>
          <a href="/availability" className="inline-flex items-center gap-2 rounded-xl bg-cyan-50 border border-cyan-200 px-6 py-3 text-sm font-semibold text-cyan-700 hover:bg-cyan-100 transition mb-8">
            🏥 Go to Availability Page →
          </a>
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 mb-8">
            <p className="text-sm text-amber-700">⚠️ Absences you mark will automatically affect assignments in the next step.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep(1)} className="rounded-xl border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">← Back</button>
            <button onClick={() => setStep(3)} className="rounded-xl bg-cyan-600 px-8 py-3 font-semibold text-white hover:bg-cyan-700 transition">Continue to Build Schedule →</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-6">
          <div className="rounded-2xl bg-white p-5 shadow">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="font-bold text-slate-700">{formatMonthYear(year, month)}</span>
                <span className="ml-3 text-sm text-slate-400">
                  {completedDays} of {totalDays} days complete
                  {warningDays > 0 && <span className="ml-2 text-amber-500">· {warningDays} with warnings</span>}
                </span>
                {saving && <span className="ml-3 text-xs text-cyan-500">💾 Saving...</span>}
              </div>
              <div className="flex gap-2">
                <button onClick={applyDefaults} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition">↺ Re-apply Defaults</button>
                <button onClick={() => setStep(4)} className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700 transition">Review & Print →</button>
              </div>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${totalDays > 0 ? (completedDays / totalDays) * 100 : 0}%` }} />
            </div>
          </div>

          <MonthlyOverview year={year} month={month} dayStatuses={dayStatuses} selectedDate={selectedDate} onSelectDate={handleSelectDate} openTuesdays={openTuesdays} holidays={holidays} />

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
                    {[1, 2].map((n) => (
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

              {selectedAssignments && selectedAssignments.warnings.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-1">
                  {selectedAssignments.warnings.map((w, i) => (
                    <p key={i} className={`text-sm font-medium ${w.severity === "error" ? "text-red-600" : "text-amber-600"}`}>
                      {w.severity === "error" ? "🔴" : "⚠️"} {w.message}
                    </p>
                  ))}
                </div>
              )}

              <DailyAssignmentPanel
                key={selectedDate}
                selectedDate={selectedDate}
                assignments={selectedAssignments}
                assistantOverrides={assistantOverrides}
                onOverrideChange={handleAssistantOverrideChange}
              />
            </div>
          ) : (
            <div className="rounded-2xl bg-white p-8 text-center shadow">
              <p className="text-slate-400">← Select a day from the calendar above to edit staffing</p>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className="rounded-xl border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">← Back</button>
          </div>
        </div>
      )}

      {step === 4 && (
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
                <p className="text-sm text-amber-700">⚠️ Some days have staffing warnings. <button onClick={() => setStep(3)} className="underline font-semibold">Go back to fix them</button>.</p>
              </div>
            )}
          </div>

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
                    daySched.hygienistsRequired ?? 1
                  ) : null;

                  const ao = daySched?.assistantOverrides ?? {};
                  const resolvedDentists = assignments?.dentists.map(({ dentist, assistant }) => {
                    if (dentist.id in ao) {
                      const ovId = ao[dentist.id];
                      const overriddenAssistant = ovId != null ? staff.find((e) => e.id === ovId) ?? null : null;
                      return { dentist, assistant: overriddenAssistant };
                    }
                    return { dentist, assistant };
                  });

                  const status = dayStatuses[day.date];
                  const dateLabel = new Date(day.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                  return (
                    <tr key={day.date} className="border-b hover:bg-slate-50 cursor-pointer" onClick={() => { handleSelectDate(day.date); setStep(3); }}>
                      <td className="p-4 font-medium">
                        {dateLabel}
                        {day.isTuesday && <span className="ml-2 rounded-full bg-blue-100 text-blue-600 text-xs px-1.5 py-0.5">Tue</span>}
                        {day.isHoliday && <span className="ml-2 rounded-full bg-red-100 text-red-600 text-xs px-1.5 py-0.5">{day.holidayName}</span>}
                      </td>
                      <td className="p-4">
                        {resolvedDentists?.map(({ dentist, assistant }) => (
                          <div key={dentist.id} className="flex items-center gap-1.5 text-xs mb-0.5">
                            <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: dentist.color }} />
                            <span className="font-medium">{dentist.name}</span>
                            <span className="text-slate-400">/ {assistant?.name ?? "No Assistant"}</span>
                            {dentist.id in ao && <span className="text-cyan-400 text-xs">(manual)</span>}
                          </div>
                        )) ?? <span className="text-slate-300 text-xs">Not configured</span>}
                      </td>
                      <td className="p-4 text-xs text-slate-600">
                        {assignments?.frontDesk.map((e) => e.name).join(", ") ?? "—"}
                        {daySched?.frontDeskRequired === 1 && <span className="ml-1 text-orange-400">(1 req.)</span>}
                      </td>
                      <td className="p-4 text-xs text-slate-600">
                        {assignments?.hygienists.map((e) => e.name).join(", ") ?? "—"}
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
            <button onClick={() => setStep(3)} className="rounded-xl border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">← Back to Edit</button>
            <PrintSchedule year={year} month={month} schedule={schedule} />
            <PrintIndividualSchedule year={year} month={month} schedule={schedule} />
          </div>
        </div>
      )}
    </div>
  );
}
