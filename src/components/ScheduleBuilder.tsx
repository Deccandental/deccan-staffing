"use client";

import { useState, useEffect, useMemo } from "react";
import { loadStaff, loadPrefs, DentistPrefs } from "@/lib/staffStore";
import { buildDailyAssignments } from "@/lib/assignmentEngine";
import { generateMonth, formatMonthYear } from "@/utils/calendar";
import { getWeekday } from "@/lib/dateUtils";
import { getOverrides, StaffOverride } from "@/lib/overrides";
import { getOpenTuesdays, OpenTuesday } from "@/lib/openTuesdays";
import { loadSchedule, saveDaySchedule, MonthSchedule } from "@/lib/scheduleStore";
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
  const [schedule, setSchedule] = useState<MonthSchedule>({});
  const [selectedDate, setSelectedDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const [s, o, p, ot] = await Promise.all([loadStaff(), getOverrides(), loadPrefs(), getOpenTuesdays()]);
      setStaff(s);
      setOverrides(o);
      setPrefs(p);
      setOpenTuesdays(ot);
    }
    load();

    async function handleVisibility() {
      if (document.visibilityState === "visible") {
        const [o, ot] = await Promise.all([getOverrides(), getOpenTuesdays()]);
        setOverrides(o);
        setOpenTuesdays(ot);
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

  const openDays = generateMonth(year, month, openTuesdays).filter((d) => d.isOpen);

  async function applyDefaults() {
    const filled: MonthSchedule = { ...schedule };
    const toSave: { date: string; dentists: string[]; frontDeskRequired: number }[] = [];
    for (const day of openDays) {
      if (!filled[day.date]) {
        const dowKey = getWeekday(day.date);
        const dentists = staff
          .filter((e) => e.role === "Dentist" && (day.isOpenTuesday || e.defaultSchedule[dowKey]))
          .map((e) => e.name);
        filled[day.date] = { dentists, frontDeskRequired: 2 };
        toSave.push({ date: day.date, dentists, frontDeskRequired: 2 });
      }
    }
    setSchedule(filled);
    setSaving(true);
    await Promise.all(toSave.map(({ date, dentists, frontDeskRequired }) => saveDaySchedule(date, dentists, frontDeskRequired)));
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
      setSchedule((c) => ({ ...c, [date]: { dentists, frontDeskRequired: 2 } }));
      await saveDaySchedule(date, dentists, 2);
    }
  }

  async function setWorkingDentists(dentists: string[]) {
    if (!selectedDate) return;
    const frontDeskRequired = schedule[selectedDate]?.frontDeskRequired ?? 2;
    setSchedule((c) => ({ ...c, [selectedDate]: { dentists, frontDeskRequired } }));
    setSaving(true);
    await saveDaySchedule(selectedDate, dentists, frontDeskRequired);
    setSaving(false);
  }

  async function setFrontDeskRequired(required: number) {
    if (!selectedDate) return;
    const dentists = schedule[selectedDate]?.dentists ?? [];
    setSchedule((c) => ({ ...c, [selectedDate]: { dentists, frontDeskRequired: required } }));
    setSaving(true);
    await saveDaySchedule(selectedDate, dentists, required);
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
        daySched.frontDeskRequired ?? 2
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

  const selectedAssignments = useMemo(() => {
    if (!selectedDate) return undefined;
    const day = openDays.find((d) => d.date === selectedDate);
    const isOpenTuesday = day?.isTuesday && day?.isOpenTuesday ? true : false;
    const fdr = schedule[selectedDate]?.frontDeskRequired ?? 2;
    return buildDailyAssignments(staff, workingDentists, selectedDate, prefs, overrides, isOpenTuesday, fdr);
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
      {/* Stepper */}
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

      {/* Step 1 */}
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

      {/* Step 2 */}
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

      {/* Step 3 */}
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
            <div
