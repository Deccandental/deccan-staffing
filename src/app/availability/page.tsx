"use client";

import { useState, useEffect } from "react";
import { loadLeaveRequests } from "@/lib/leaveStore";
import { LeaveRequest } from "@/types/leave";
import { Sidebar } from "@/components/Sidebar";
import { employees } from "@/data/employees";
import { generateMonth, formatMonthYear } from "@/utils/calendar";
import {
  getOverrideForDate,
  setUnavailable,
  clearUnavailable,
  getOverrides,
  StaffOverride,
} from "@/lib/overrides";

const ROLES = ["Dentist", "Assistant", "Front Desk", "Hygienist"] as const;

const DAY_MAP: Record<string, keyof typeof employees[0]["defaultSchedule"]> = {
  Mon: "monday", Tue: "tuesday", Wed: "wednesday", Thu: "thursday", Fri: "friday",
};

const REASONS = [
  { key: "sick" as const, label: "Sick", active: "bg-red-100 border-red-300 text-red-700", cell: "bg-red-200 border-red-300 text-red-700", halfCell: "border-red-300 text-red-700", letter: "S", color: "#fecaca", halfColor: "#fee2e2" },
  { key: "pto" as const, label: "PTO", active: "bg-blue-100 border-blue-300 text-blue-700", cell: "bg-blue-200 border-blue-300 text-blue-700", halfCell: "border-blue-300 text-blue-700", letter: "P", color: "#bfdbfe", halfColor: "#dbeafe" },
  { key: "leave" as const, label: "Leave", active: "bg-purple-100 border-purple-300 text-purple-700", cell: "bg-purple-200 border-purple-300 text-purple-700", halfCell: "border-purple-300 text-purple-700", letter: "L", color: "#e9d5ff", halfColor: "#f3e8ff" },
  { key: "other" as const, label: "Other", active: "bg-slate-200 border-slate-300 text-slate-700", cell: "bg-slate-200 border-slate-300 text-slate-600", halfCell: "border-slate-300 text-slate-600", letter: "O", color: "#e2e8f0", halfColor: "#f1f5f9" },
];

// Cycle: working -> half AM -> half PM -> full day -> working
function getNextState(override: StaffOverride | undefined): "clear" | "halfAM" | "halfPM" | "full" {
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

  const days = generateMonth(year, month).filter((d) => d.isOpen);

  useEffect(() => {
    setOverrides(getOverrides());
    setLeaveRequests(loadLeaveRequests());
  }, [year, month]);

  function refresh() { setOverrides(getOverrides()); }

  function handleToggle(employeeId: number, date: string) {
    const override = overrides.find((o) => o.employeeId === employeeId && o.date === date);
    const next = getNextState(override);
    if (next === "clear") {
      clearUnavailable(employeeId, date);
    } else if (next === "halfAM") {
      setUnavailable(employeeId, date, selectedReason, "AM");
    } else if (next === "halfPM") {
      setUnavailable(employeeId, date, selectedReason, "PM");
    } else {
      setUnavailable(employeeId, date, selectedReason, null);
    }
    refresh();
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

  const byRole = ROLES.map((role) => ({
    role,
    members: employees.filter((e) => e.role === role),
  }));

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

        {/* Controls */}
        <div className="mb-6 flex flex-wrap items-center gap-4">
          {/* Month picker */}
          <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 shadow">
            <button onClick={prevMonth} className="px-2 text-slate-400 hover:text-slate-900">←</button>
            <span className="min-w-[130px] text-center font-semibold">{formatMonthYear(year, month)}</span>
            <button onClick={nextMonth} className="px-2 text-slate-400 hover:text-slate-900">→</button>
          </div>

          {/* Reason selector */}
          <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 shadow">
            <span className="text-sm text-slate-500">Mark as:</span>
            {REASONS.map((r) => (
              <button
                key={r.key}
                onClick={() => setSelectedReason(r.key)}
                className={`rounded-lg border px-3 py-1 text-sm font-medium transition ${
                  selectedReason === r.key ? r.active : "border-slate-200 text-slate-400 hover:bg-slate-50"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-4 w-4 rounded bg-green-100 border border-green-200" /> Working
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-4 w-4 rounded border border-slate-300 overflow-hidden relative">
                <span style={{ position: "absolute", left: 0, top: 0, width: "50%", height: "100%", background: "#bfdbfe" }} />
                <span style={{ position: "absolute", right: 0, top: 0, width: "50%", height: "100%", background: "#bbf7d0" }} />
              </span>
              AM off
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-4 w-4 rounded border border-slate-300 overflow-hidden relative">
                <span style={{ position: "absolute", left: 0, top: 0, width: "50%", height: "100%", background: "#bbf7d0" }} />
                <span style={{ position: "absolute", right: 0, top: 0, width: "50%", height: "100%", background: "#bfdbfe" }} />
              </span>
              PM off
            </span>
            {REASONS.map((r) => (
              <span key={r.key} className="flex items-center gap-1">
                <span className={`inline-block h-4 w-4 rounded ${r.cell}`} /> {r.label}
              </span>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="space-y-8">
          {byRole.map(({ role, members }) => (
            <div key={role} className="rounded-2xl bg-white shadow overflow-hidden">
              <div className="px-6 py-4 border-b">
                <h2 className="text-lg font-bold">{role}s</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="p-3 text-left font-semibold text-slate-500 w-36">Name</th>
                      {days.map((d) => (
                        <th key={d.date} className="p-2 text-center font-medium text-slate-400 min-w-[44px]">
                          <div className="text-xs">{d.weekday}</div>
                          <div className="text-xs font-bold text-slate-600">{d.day}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((emp) => (
                      <tr key={emp.id} className="border-t">
                        <td className="p-3 font-medium">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: emp.color }} />
                            {emp.name}
                          </div>
                        </td>
                        {days.map((d) => {
                          const schedKey = DAY_MAP[d.weekday];
                          const worksDefault = schedKey ? emp.defaultSchedule[schedKey] : false;
                          const override = getOverride(emp.id, d.date);
                          const reasonStyle = REASONS.find((r) => r.key === override?.reason) ?? REASONS[1];

                          // Check approved partial leave from leave requests
                          const approvedHalfReq = leaveRequests.find(
                            (r) => r.employeeId === emp.id &&
                              r.startDate <= d.date && r.endDate >= d.date &&
                              r.isPartialDay && r.status === "approved"
                          );

                          const isFullDay = override && !override.halfDay;
                          const isHalfAM = override?.halfDay === "AM";
                          const isHalfPM = override?.halfDay === "PM";
                          const isHalfFromLeave = approvedHalfReq && !override;

                          const tooltip = isFullDay
                            ? `${override?.reason} — full day out. Click to clear.`
                            : isHalfAM
                            ? `AM off (${override?.reason}). Click for PM off.`
                            : isHalfPM
                            ? `PM off (${override?.reason}). Click for full day.`
                            : isHalfFromLeave
                            ? `Half day from approved leave: ${approvedHalfReq?.partialHours || "partial"}`
                            : "Click: AM off → PM off → Full day → Clear";

                          return (
                            <td key={d.date} className="p-1 text-center">
                              {!worksDefault ? (
                                <div className="mx-auto h-8 w-8 flex items-center justify-center text-slate-200 text-xs">—</div>
                              ) : isFullDay ? (
                                // Full day out
                                <button
                                  onClick={() => handleToggle(emp.id, d.date)}
                                  title={tooltip}
                                  className={`mx-auto h-8 w-8 rounded border text-xs font-bold transition hover:opacity-75 flex items-center justify-center ${reasonStyle.cell}`}
                                >
                                  {reasonStyle.letter}
                                </button>
                              ) : isHalfAM ? (
                                // AM off — left half = reason color, right half = green
                                <button
                                  onClick={() => handleToggle(emp.id, d.date)}
                                  title={tooltip}
                                  className="mx-auto h-8 w-8 rounded border flex items-center justify-center relative overflow-hidden hover:opacity-75 transition"
                                  style={{ borderColor: reasonStyle.color }}
                                >
                                  <div style={{ position: "absolute", top: 0, left: 0, width: "50%", height: "100%", background: reasonStyle.color }} />
                                  <div style={{ position: "absolute", top: 0, right: 0, width: "50%", height: "100%", background: "#bbf7d0" }} />
                                  <span style={{ position: "relative", zIndex: 1, fontSize: 8, fontWeight: 700, color: "#374151" }}>AM</span>
                                </button>
                              ) : isHalfPM ? (
                                // PM off — left half = green, right half = reason color
                                <button
                                  onClick={() => handleToggle(emp.id, d.date)}
                                  title={tooltip}
                                  className="mx-auto h-8 w-8 rounded border flex items-center justify-center relative overflow-hidden hover:opacity-75 transition"
                                  style={{ borderColor: reasonStyle.color }}
                                >
                                  <div style={{ position: "absolute", top: 0, left: 0, width: "50%", height: "100%", background: "#bbf7d0" }} />
                                  <div style={{ position: "absolute", top: 0, right: 0, width: "50%", height: "100%", background: reasonStyle.color }} />
                                  <span style={{ position: "relative", zIndex: 1, fontSize: 8, fontWeight: 700, color: "#374151" }}>PM</span>
                                </button>
                              ) : isHalfFromLeave ? (
                                // Half day from approved leave request
                                <div
                                  className="mx-auto h-8 w-8 rounded border flex items-center justify-center relative overflow-hidden cursor-default"
                                  title={tooltip}
                                  style={{ border: "1px solid #93c5fd" }}
                                >
                                  <div style={{ position: "absolute", top: 0, left: 0, width: "50%", height: "100%", background: "#dbeafe" }} />
                                  <div style={{ position: "absolute", top: 0, right: 0, width: "50%", height: "100%", background: "#bbf7d0" }} />
                                  <span style={{ position: "relative", zIndex: 1, fontSize: 9, color: "#1e40af", fontWeight: 700 }}>½</span>
                                </div>
                              ) : (
                                // Working / available
                                <button
                                  onClick={() => handleToggle(emp.id, d.date)}
                                  title={tooltip}
                                  className="mx-auto h-8 w-8 rounded border text-xs font-bold transition hover:opacity-75 flex items-center justify-center bg-green-100 border-green-200 text-green-700"
                                >
                                  ✓
                                </button>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
