"use client";

import { useState, useEffect } from "react";
import { loadLeaveRequests } from "@/lib/leaveStore";
import { LeaveRequest } from "@/types/leave";
import { Sidebar } from "@/components/Sidebar";
import { loadStaff } from "@/lib/staffStore";
import { Employee } from "@/types/employee";
import { generateMonth, formatMonthYear } from "@/utils/calendar";
import { getOpenTuesdays, OpenTuesday } from "@/lib/openTuesdays";
import {
  getOverrides, setUnavailable, clearUnavailable, StaffOverride,
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
  const [openTuesdays, setOpenTuesdays] = useState<OpenTuesday[]>([]);
  const [loading, setLoading] = useState(true);

  const days = loading ? [] : generateMonth(year, month, openTuesdays).filter((d) => d.isOpen);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [o, l, s, ot] = await Promise.all([getOverrides(), loadLeaveRequests(), loadStaff(), getOpenTuesdays()]);
      setOverrides(o);
      setLeaveRequests(l);
      setStaff(s);
      setOpenTuesdays(ot);
      setLoading(false);
    }
    load();
  }, [year, month]);

  async function refresh() {
    const [o, ot] = await Promise.all([getOverrides(), getOpenTuesdays()]);
    setOverrides(o);
    setOpenTuesdays(ot);
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
          Tuesdays only appear if marked open in <a href="/holidays" className="text-blue-500 underline">Holidays & Closures</a>.
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
            <span className="flex items-center gap-1"><span className="inline-block h-4 w-4 rounded bg-green-100 border border-green-200" /> Working</span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-4 w-4 rounded border border-slate-300 overflow-hidden relative">
                <span style={{ position: "absolute", left: 0, top: 0, width: "50%", height: "100%", background: "#bfdbfe" }} />
                <span style={{ position: "absolute", right: 0, top: 0, width: "50%", height: "100%", background: "#bbf7d0" }} />
              </span> AM off
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-4 w-4 rounded border border-slate-300 overflow-hidden relative">
                <span style={{ position: "absolute", left: 0, top: 0, width: "50%", height: "100%", background: "#bbf7d0" }} />
                <span style={{ position: "absolute", right: 0, top: 0, width: "50%", height: "100%", background: "#bfdbfe" }} />
              </span> PM off
            </span>
            {REASONS.map((r) => (
              <span key={r.key} className="flex items-center gap-1">
                <span className={`inline-block h-4 w-4 rounded ${r.cell}`} /> {r.label}
              </span>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-20 text-slate-400">Loading availability...</div>
        ) : (
          <div className="space-y-8">
            {ROLE_GROUPS.map(({ label, roles }) => {
              const members = staff.filter((e) => (roles as readonly string[]).includes(e.role));
              if (members.length === 0) return null;
              return (
                <div key={label} className="rounded-2xl bg-white shadow overflow-hidden">
                  <div className="px-6 py-4 border-b flex items-center gap-3">
                    <h2 className="text-lg font-bold">{label}</h2>
                    <span className="rounded-full bg-slate-100 text-slate-500 text-xs font-semibold px-2 py-0.5">{members.length}</span>
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
                              {d.isTuesday && <div className="text-xs text-blue-400">Tue</div>}
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
                                <span>{emp.name}</span>
                              </div>
                              <div className="text-xs text-slate-400 ml-4">{emp.role}</div>
                            </td>
                            {days.map((d) => {
                              const schedKey = DAY_MAP[d.weekday];
                              const worksDefault = schedKey ? emp.defaultSchedule[schedKey] : false;
                              const isTuesdayOpen = d.isTuesday && d.isOpenTuesday;
                              const shouldShow = worksDefault || isTuesdayOpen;
                              const override = getOverride(emp.id, d.date);
                              const reasonStyle = REASONS.find((r) => r.key === override?.reason) ?? REASONS[1];

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
                                : isHalfAM ? `AM off (${override?.reason}). Click for PM off.`
                                : isHalfPM ? `PM off (${override?.reason}). Click for full day.`
                                : isHalfFromLeave ? `Half day from approved leave`
                                : "Click: AM off → PM off → Full day → Clear";

                              return (
                                <td key={d.date} className="p-1 text-center">
                                  {!shouldShow ? (
                                    <div className="mx-auto h-8 w-8 flex items-center justify-center text-slate-200 text-xs">—</div>
                                  ) : isFullDay ? (
                                    <button onClick={() => handleToggle(emp.id, d.date)} title={tooltip}
                                      className={`mx-auto h-8 w-8 rounded border text-xs font-bold transition hover:opacity-75 flex items-center justify-center ${reasonStyle.cell}`}>
                                      {reasonStyle.letter}
                                    </button>
                                  ) : isHalfAM ? (
                                    <button onClick={() => handleToggle(emp.id, d.date)} title={tooltip}
                                      className="mx-auto h-8 w-8 rounded border flex items-center justify-center relative overflow-hidden hover:opacity-75 transition"
                                      style={{ borderColor: reasonStyle.color }}>
                                      <div style={{ position: "absolute", top: 0, left: 0, width: "50%", height: "100%", background: reasonStyle.color }} />
                                      <div style={{ position: "absolute", top: 0, right: 0, width: "50%", height: "100%", background: "#bbf7d0" }} />
                                      <span style={{ position: "relative", zIndex: 1, fontSize: 8, fontWeight: 700, color: "#374151" }}>AM</span>
                                    </button>
                                  ) : isHalfPM ? (
                                    <button onClick={() => handleToggle(emp.id, d.date)} title={tooltip}
                                      className="mx-auto h-8 w-8 rounded border flex items-center justify-center relative overflow-hidden hover:opacity-75 transition"
                                      style={{ borderColor: reasonStyle.color }}>
                                      <div style={{ position: "absolute", top: 0, left: 0, width: "50%", height: "100%", background: "#bbf7d0" }} />
                                      <div style={{ position: "absolute", top: 0, right: 0, width: "50%", height: "100%", background: reasonStyle.color }} />
                                      <span style={{ position: "relative", zIndex: 1, fontSize: 8, fontWeight: 700, color: "#374151" }}>PM</span>
                                    </button>
                                  ) : isHalfFromLeave ? (
                                    <div title={tooltip}
                                      className="mx-auto h-8 w-8 rounded border flex items-center justify-center relative overflow-hidden cursor-default"
                                      style={{ border: "1px solid #93c5fd" }}>
                                      <div style={{ position: "absolute", top: 0, left: 0, width: "50%", height: "100%", background: "#dbeafe" }} />
                                      <div style={{ position: "absolute", top: 0, right: 0, width: "50%", height: "100%", background: "#bbf7d0" }} />
                                      <span style={{ position: "relative", zIndex: 1, fontSize: 9, color: "#1e40af", fontWeight: 700 }}>½</span>
                                    </div>
                                  ) : (
                                    <button onClick={() => handleToggle(emp.id, d.date)} title={tooltip}
                                      className="mx-auto h-8 w-8 rounded border text-xs font-bold transition hover:opacity-75 flex items-center justify-center bg-green-100 border-green-200 text-green-700">
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
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
