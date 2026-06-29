"use client";

import { useState, useEffect } from "react";
import { loadLeaveRequests } from "@/lib/leaveStore";
import { LeaveRequest } from "@/types/leave";
import { Sidebar } from "@/components/Sidebar";
import { loadStaff } from "@/lib/staffStore";
import { Employee } from "@/types/employee";
import { generateMonth, formatMonthYear } from "@/utils/calendar";
import {
  getOverrides,
  setUnavailable,
  clearUnavailable,
  StaffOverride,
} from "@/lib/overrides";

const ROLE_GROUPS = [
  { label: "Dentists", roles: ["Dentist"] },
  { label: "Assistants & RDAs", roles: ["Assistant", "RDA"] },
  { label: "Front Desk", roles: ["Front Desk"] },
  { label: "Hygienists", roles: ["Hygienist"] },
] as const;

const DAY_MAP: Record<string, keyof Employee["defaultSchedule"]> = {
  Mon: "monday", Tue: "tuesday", Wed: "wednesday", Thu: "thursday", Fri: "friday",
};

const REASONS = [
  { key: "sick" as const, label: "Sick", active: "bg-red-100 border-red-300 text-red-700", cell: "bg-red-200 border-red-300 text-red-700", letter: "S", color: "#fecaca" },
  { key: "pto" as const, label: "PTO", active: "bg-blue-100 border-blue-300 text-blue-700", cell: "bg-blue-200 border-blue-300 text-blue-700", letter: "P", color: "#bfdbfe" },
  { key: "leave" as const, label: "Leave", active: "bg-purple-100 border-purple-300 text-purple-700", cell: "bg-purple-200 border-purple-300 text-purple-700", letter: "L", color: "#e9d5ff" },
  { key: "other" as const, label: "Other", active: "bg-slate-200 border-slate-300 text-slate-700", cell: "bg-slate-200 border-slate-300 text-slate-600", letter: "O", color: "#e2e8f0" },
];

function getNextState(override: StaffOverride | undefined): "halfAM" | "halfPM" | "full" | "clear" {
  if (!override) return "halfAM";
  if (override.halfDay === "AM") return "halfPM";
  if (override.halfDay === "PM") return "full";
  return "clear";
}

export default function AvailabilityPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [overrides, setOverrides] = useState<StaffOverride[]>([]);
  const [selectedReason, setSelectedReason] = useState<StaffOverride["reason"]>("pto");
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const days = generateMonth(year, month).filter((d) => d.isOpen);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [o, l, s] = await Promise.all([getOverrides(), loadLeaveRequests(), loadStaff()]);
      setOverrides(o);
      setLeaveRequests(l);
      setStaff(s);
      setLoading(false);
    }
    load();
  }, [year, month]);

  async function refresh() {
    const o = await getOverrides();
    setOverrides(o);
  }

  async function handleToggle(employeeId: number, date: string) {
    const override = overrides.find((o) => o.employeeId === employeeId && o.date === date);
    const next = getNextState(override);
    if (next === "clear") await clearUnavailable(employeeId, date);
    else if (next === "halfAM") await setUnavailable(employeeId, date, selectedReason, "AM");
    else if (next === "halfPM") await setUnavailable(employeeId, date, selectedReason, "PM");
    else await setUnavailable(employeeId, date, selectedReason, null);
    await refresh();
  }

  function getOverride(employeeId: number, date: string) {
    return overrides.find((o) => o.employeeId === employeeId && o.date === date);
  }

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1);
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <Sidebar />
      <div className="ml-64 p-8">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-3xl font-bold">Staff Availability</h1>
          <div className="flex gap-2">
            <a href="/?step=2" className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">← Back to Absences</a>
            <a href="/?step=3" className="rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-700 transition">✓ Done — Build Schedule →</a>
          </div>
        </div>
        <p className="mb-6 text-slate-500">
          Click once for <strong>AM off</strong>, twice for <strong>PM off</strong>, three times for <strong>full day out</strong>, four times to clear.
        </p>

        <div className="mb-6 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 shadow">
            <button onClick={prevMonth} className="px-2 text-slate-400 hover:text-slate-900">←</button>
            <span className="min-w-[130px] text-center font-semibold">{formatMonthYear(year, month)}</span>
            <button onClick={nextMonth} className="px-2 text-slate-400 hover:text-slate-900">→</button>
          </div>

          <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 shadow">
            <span className="text-sm text-slate-500">Mark as:</span>
            {REASONS.map((r) => (
              <button key={r.key} onClick={() => setSelectedReason(r.key)}
                className={`rounded-lg border px-3 py-1 text-sm font-medium transition ${selectedReason === r.key ? r.active : "border-slate-200 text-slate-400 hover:bg-slate-50"}`}>
                {r.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="inline-block
