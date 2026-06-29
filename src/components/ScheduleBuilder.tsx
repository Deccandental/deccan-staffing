"use client";

import { useState, useEffect, useMemo } from "react";
import { loadStaff } from "@/lib/staffStore";
import { buildDailyAssignments } from "@/lib/assignmentEngine";
import { generateMonth, formatMonthYear } from "@/utils/calendar";
import { getWeekday } from "@/lib/dateUtils";
import { getOverrides } from "@/lib/overrides";
import { Employee } from "@/types/employee";
import MonthlyOverview from "./MonthlyOverview";
import DentistSelector from "./DentistSelector";
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
  const [schedule, setSchedule] = useState<Record<string, { dentists: string[] }>>({});
  const [selectedDate, setSelectedDate] = useState("");

  useEffect(() => { setStaff(loadStaff()); }, []);

  const SCHEDULE_KEY = "deccan-schedule-v1";

  // Persist schedule to localStorage so home calendar can read it
  useEffect(() => {
    if (typeof window !== "undefined" && Object.keys(schedule).length > 0) {
      localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedule));
    }
  }, [schedule]);

  // Load saved schedule on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(SCHEDULE_KEY);
        if (saved) setSchedule(JSON.parse(saved));
      } catch {}
    }
  }, []);

  const openDays = generateMonth(year, month).filter((d) => d.isOpen);

  // Auto-fill all days with default dentist schedules
  function applyDefaults() {
    const filled: Record<string, { dentists: string[] }> = { ...schedule };
    for (const day of openDays) {
      if (!filled[day.date]) {
        const dowKey = getWeekday(day.date);
        const dentists = staff
          .filter((e) => e.role === "Dentist" && e.defaultSchedule[dowKey])
          .map((e) => e.name);
        filled[day.date] = { dentists };
      }
    }
    setSchedule(filled);
  }

  function handleSelectDate(date: string) {
    setSelectedDate(date);
    if (!schedule[date]) {
      const dowKey = getWeekday(date);
      const dentists = staff
        .filter((e) => e.role === "Dentist" && e.defaultSchedule[dowKey])
        .map((e) => e.name);
      setSchedule((c) => ({ ...c, [date]: { dentists } }));
    }
  }

  function setWorkingDentists(dentists: string[]) {
    if (!selectedDate) return;
    setSchedule((c) => ({ ...c, [selectedDate]: { dentists } }));
  }

  // Compute status for each day
  const dayStatuses = useMemo(() => {
    const statuses: Record<string, "complete" | "warning" | "empty"> = {};
    for (const day of openDays) {
      const daySched = schedule[day.date];
      if (!daySched) { statuses[day.date] = "empty"; continue; }
      const assignments = buildDailyAssignments(staff, daySched.dentists, day.date);
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
  }, [schedule, staff, openDays]);

  const completedDays = Object.values(dayStatuses).filter((s) => s === "complete").length;
  const warningDays = Object.values(dayStatuses).filter((s) => s === "warning").length;
  const totalDays = openDays.length;

  const allDentists = staff.filter((e) => e.role === "Dentist").map((e) => e.name);
  const workingDentists = selectedDate && schedule[selectedDate] ? schedule[selectedDate].dentists : [];
  const selectedAssignments = selectedDate
    ? buildDailyAssignments(staff, workingDentists, selectedDate)
    : undefined;

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1);
    setSchedule({});
    setSelectedDate("");
  }

  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1);
    setSchedule({});
    setSelectedDate("");
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
                  step === s.id
                    ? "bg-cyan-600 text-white shadow"
                    : s.id < step
                    ? "text-cyan-600 hover:bg-cyan-50"
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

      {/* Step 1: Pick Month */}
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
            <p className="text-sm text-slate-500">{totalDays} working days in {formatMonthYear(year, month)} (Mon, Wed, Thu, Fri only)</p>
          </div>

          <button
            onClick={() => { applyDefaults(); setStep(2); }}
            className="rounded-xl bg-cyan-600 px-8 py-3 font-semibold text-white hover:bg-cyan-700 transition"
          >
            Continue to Mark Absences →
          </button>
        </div>
      )}

      {/* Step 2: Mark Absences */}
      {step === 2 && (
        <div className="rounded-2xl bg-white p-8 shadow">
          <h2 className="text-2xl font-bold mb-2">Mark staff absences</h2>
          <p className="text-slate-500 mb-6">
            Go to the <strong>Availability</strong> page to mark sick days, PTO, and leave for {formatMonthYear(year, month)}.
            Come back here when done.
          </p>

          <a
            href="/availability"
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-50 border border-cyan-200 px-6 py-3 text-sm font-semibold text-cyan-700 hover:bg-cyan-100 transition mb-8"
          >
            🏥 Go to Availability Page →
          </a>

          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 mb-8">
            <p className="text-sm text-amber-700">
              ⚠️ Absences you mark will automatically affect assignments in the next step.
            </p>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(1)} className="rounded-xl border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">← Back</button>
            <button onClick={() => setStep(3)} className="rounded-xl bg-cyan-600 px-8 py-3 font-semibold text-white hover:bg-cyan-700 transition">Continue to Build Schedule →</button>
          </div>
        </div>
      )}

      {/* Step 3: Build Schedule */}
      {step === 3 && (
        <div className="space-y-6">
          {/* Progress bar */}
          <div className="rounded-2xl bg-white p-5 shadow">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="font-bold text-slate-700">{formatMonthYear(year, month)}</span>
                <span className="ml-3 text-sm text-slate-400">
                  {completedDays} of {totalDays} days complete
                  {warningDays > 0 && <span className="ml-2 text-amber-500">· {warningDays} with warnings</span>}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={applyDefaults}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                >
                  ↺ Re-apply Defaults
                </button>
                <button
                  onClick={() => setStep(4)}
                  className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700 transition"
                >
                  Review & Print →
                </button>
              </div>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-cyan-500 transition-all"
                style={{ width: `${totalDays > 0 ? (completedDays / totalDays) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* Monthly overview calendar */}
          <MonthlyOverview
            year={year}
            month={month}
            dayStatuses={dayStatuses}
            selectedDate={selectedDate}
            onSelectDate={handleSelectDate}
          />

          {/* Day editor */}
          {selectedDate ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl bg-white p-6 shadow">
                <h3 className="text-lg font-bold mb-1">
                  {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                </h3>
                <p className="text-sm text-slate-400 mb-5">Select which dentists are working today</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {allDentists.map((name) => {
                    const checked = workingDentists.includes(name);
                    const emp = staff.find((e) => e.name === name);
                    return (
                      <button
                        key={name}
                        onClick={() => setWorkingDentists(checked ? workingDentists.filter((d) => d !== name) : [...workingDentists, name])}
                        className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${checked ? "border-cyan-500 bg-cyan-50" : "border-slate-200 hover:bg-slate-50"}`}
                      >
                        <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: emp?.color ?? "#888" }} />
                        <span className="text-sm font-medium">{name}</span>
                        <span className={`ml-auto h-4 w-4 rounded border flex items-center justify-center text-xs ${checked ? "bg-cyan-500 border-cyan-500 text-white" : "border-slate-300"}`}>
                          {checked ? "✓" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <DailyAssignmentPanel
                selectedDate={selectedDate}
                assignments={selectedAssignments}
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

      {/* Step 4: Review & Print */}
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
                <p className="text-sm text-amber-700">⚠️ Some days have staffing warnings. Review them before printing or <button onClick={() => setStep(3)} className="underline font-semibold">go back to fix them</button>.</p>
              </div>
            )}
          </div>

          {/* Full monthly table */}
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
                  const assignments = daySched
                    ? buildDailyAssignments(staff, daySched.dentists, day.date)
                    : null;
                  const status = dayStatuses[day.date];
                  const dateLabel = new Date(day.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

                  return (
                    <tr
                      key={day.date}
                      className="border-b hover:bg-slate-50 cursor-pointer"
                      onClick={() => { handleSelectDate(day.date); setStep(3); }}
                    >
                      <td className="p-4 font-medium">{dateLabel}</td>
                      <td className="p-4">
                        {assignments?.dentists.map(({ dentist, assistant }) => (
                          <div key={dentist.id} className="flex items-center gap-1.5 text-xs mb-0.5">
                            <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: dentist.color }} />
                            <span className="font-medium">{dentist.name}</span>
                            <span className="text-slate-400">/ {assistant?.name ?? "No Assistant"}</span>
                          </div>
                        )) ?? <span className="text-slate-300 text-xs">Not configured</span>}
                      </td>
                      <td className="p-4 text-xs text-slate-600">
                        {assignments?.frontDesk.map((e) => e.name).join(", ") ?? "—"}
                      </td>
                      <td className="p-4 text-xs text-slate-600">
                        {assignments?.hygienists.map((e) => e.name).join(", ") ?? "—"}
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
