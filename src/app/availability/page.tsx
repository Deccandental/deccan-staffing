"use client";

import { useState, useEffect } from "react";
import { loadLeaveRequests } from "@/lib/leaveStore";
import { LeaveRequest } from "@/types/leave";
import { Sidebar } from "@/components/Sidebar";
import { employees } from "@/data/employees";
import { generateMonth, formatMonthYear } from "@/utils/calendar";
import {
  isUnavailable,
  setUnavailable,
  clearUnavailable,
  getOverrides,
  StaffOverride,
} from "@/lib/overrides";

const ROLES = ["Dentist", "Assistant", "Front Desk", "Hygienist"] as const;

const DAY_MAP: Record<string, keyof typeof employees[0]["defaultSchedule"]> = {
  Mon: "monday", Wed: "wednesday", Thu: "thursday", Fri: "friday",
};

const REASONS = [
  { key: "sick" as const, label: "Sick", active: "bg-red-100 border-red-300 text-red-700", cell: "bg-red-200 border-red-300 text-red-700", letter: "S" },
  { key: "pto" as const, label: "PTO", active: "bg-blue-100 border-blue-300 text-blue-700", cell: "bg-blue-200 border-blue-300 text-blue-700", letter: "P" },
  { key: "leave" as const, label: "Leave", active: "bg-purple-100 border-purple-300 text-purple-700", cell: "bg-purple-200 border-purple-300 text-purple-700", letter: "L" },
  { key: "other" as const, label: "Other", active: "bg-slate-200 border-slate-300 text-slate-700", cell: "bg-slate-200 border-slate-300 text-slate-600", letter: "O" },
];

export default function AvailabilityPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [overrides, setOverrides] = useState<StaffOverride[]>([]);
  const [selectedReason, setSelectedReason] = useState<StaffOverride["reason"]>("pto");

  const days = generateMonth(year, month).filter((d) => d.isOpen);

  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  useEffect(() => { setOverrides(getOverrides()); setLeaveRequests(loadLeaveRequests()); }, []);

  function refresh() { setOverrides(getOverrides()); }

  function handleToggle(employeeId: number, date: string) {
    if (isUnavailable(employeeId, date)) {
      clearUnavailable(employeeId, date);
    } else {
      setUnavailable(employeeId, date, selectedReason);
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
          Click a green cell to mark someone out. Click again to clear.
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

          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="inline-block h-4 w-4 rounded bg-green-100 border border-green-200" /> Working</span>
            {REASONS.map((r) => (
              <span key={r.key} className="flex items-center gap-1">
                <span className={`inline-block h-4 w-4 rounded ${r.cell}`} /> {r.label}
              </span>
            ))}
          </div>
        </div>

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
                          const unavail = !!override;
                          const reasonStyle = REASONS.find((r) => r.key === override?.reason);

                          const halfDayReq = leaveRequests.find(
                            (r) => r.employeeId === emp.id &&
                            r.startDate <= d.date && r.endDate >= d.date &&
                            r.isPartialDay && r.status === "approved"
                          );

                          return (
                            <td key={d.date} className="p-1 text-center">
                              {!worksDefault ? (
                                <div className="mx-auto h-8 w-8 flex items-center justify-center text-slate-200 text-xs">—</div>
                              ) : halfDayReq && !unavail ? (
                                <div
                                  className="mx-auto h-8 w-8 rounded border flex items-center justify-center relative overflow-hidden cursor-default"
                                  title={`Half day: ${halfDayReq.partialHours || "partial"}`}
                                  style={{ border: "1px solid #93c5fd" }}
                                >
                                  <div style={{ position: "absolute", top: 0, left: 0, width: "50%", height: "100%", background: "#dbeafe" }} />
                                  <div style={{ position: "absolute", top: 0, right: 0, width: "50%", height: "100%", background: "#bbf7d0" }} />
                                  <span style={{ position: "relative", zIndex: 1, fontSize: 9, color: "#1e40af", fontWeight: 700 }}>½</span>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleToggle(emp.id, d.date)}
                                  title={unavail ? `${override?.reason} — click to clear` : "Click to mark unavailable"}
                                  className={`mx-auto h-8 w-8 rounded border text-xs font-bold transition hover:opacity-75 flex items-center justify-center ${
                                    unavail && reasonStyle ? reasonStyle.cell : "bg-green-100 border-green-200 text-green-700"
                                  }`}
                                >
                                  {unavail && reasonStyle ? reasonStyle.letter : "✓"}
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
