"use client";

import { useState, useEffect, useMemo } from "react";
import { Sidebar } from "@/components/Sidebar";
import { loadStaff } from "@/lib/staffStore";
import { Employee } from "@/types/employee";
import { LeaveReason, LeaveRequest } from "@/types/leave";
import { addLeaveRequest, loadLeaveRequests, cancelLeaveRequest, countBusinessDays, validateNoticePeriod } from "@/lib/leaveStore";
import { getOverrides, StaffOverride } from "@/lib/overrides";
import { generateMonth, formatMonthYear } from "@/utils/calendar";

const REASON_LABELS: Record<LeaveReason, string> = {
  sick: "Sick Leave", pto: "PTO / Vacation", leave: "Personal Leave", other: "Other",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  denied: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-400",
  manual: "bg-purple-100 text-purple-700",
};

const PASSCODE = "2503";

interface AbsenceEntry {
  type: "request" | "manual";
  employeeId: number;
  employeeName: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  reason: string;
  status?: string;
  notes?: string;
  reviewNote?: string;
  totalDays?: number;
  submittedAt?: string;
}

export default function LeavePage() {
  const [staff, setStaff] = useState<Employee[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [overrides, setOverrides] = useState<StaffOverride[]>([]);
  const [view, setView] = useState<"request" | "my" | "calendar" | "all">("request");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [noticeWarning, setNoticeWarning] = useState("");
  const [allPasscode, setAllPasscode] = useState("");
  const [allAuthenticated, setAllAuthenticated] = useState(false);
  const [allPasscodeError, setAllPasscodeError] = useState(false);
  const [filterEmployee, setFilterEmployee] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const today0 = new Date();
  const [calYear, setCalYear] = useState(today0.getFullYear());
  const [calMonth, setCalMonth] = useState(today0.getMonth() + 1);

  const [form, setForm] = useState({
    employeeId: "", employeeEmail: "", startDate: "", endDate: "",
    isPartialDay: false, partialHours: "", reason: "pto" as LeaveReason, notes: "",
  });

  useEffect(() => {
    async function load() {
      const [s, r, o] = await Promise.all([loadStaff(), loadLeaveRequests(), getOverrides()]);
      setStaff(s);
      setRequests(r);
      setOverrides(o);
    }
    load();
  }, []);

  useEffect(() => {
    async function load() {
      const [r, o] = await Promise.all([loadLeaveRequests(), getOverrides()]);
      setRequests(r);
      setOverrides(o);
    }
    load();
  }, [view]);

  async function refresh() {
    const [r, o] = await Promise.all([loadLeaveRequests(), getOverrides()]);
    setRequests(r);
    setOverrides(o);
  }

  const selectedEmployee = staff.find((e) => e.id === Number(form.employeeId));
  const totalDays = form.startDate && form.endDate ? countBusinessDays(form.startDate, form.endDate) : 0;

  function handleDateChange(field: "startDate" | "endDate", value: string) {
    const updated = { ...form, [field]: value };
    setForm(updated);
    if (updated.startDate && updated.endDate) {
      const days = countBusinessDays(updated.startDate, updated.endDate);
      setNoticeWarning(validateNoticePeriod(updated.startDate, days) ?? "");
    }
  }

  async function handleSubmit() {
    setError("");
    if (!form.employeeId) { setError("Please select your name."); return; }
    if (!form.employeeEmail) { setError("Please enter your email."); return; }
    if (!form.startDate || !form.endDate) { setError("Please select start and end dates."); return; }
    if (form.endDate < form.startDate) { setError("End date must be after start date."); return; }

    const req = await addLeaveRequest({
      employeeId: Number(form.employeeId), employeeName: selectedEmployee?.name ?? "",
      employeeEmail: form.employeeEmail, startDate: form.startDate, endDate: form.endDate,
      isPartialDay: form.isPartialDay, partialHours: form.partialHours,
      reason: form.reason, notes: form.notes, totalDays,
    });

    try {
      await fetch("/api/leave/notify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: req, type: "submitted" }),
      });
    } catch {}

    setSubmitted(true);
    await refresh();
  }

  const myRequests = requests.filter((r) => r.employeeId === Number(form.employeeId));

  const allAbsences: AbsenceEntry[] = [
    ...requests.map((r) => ({
      type: "request" as const,
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      startDate: r.startDate,
      endDate: r.endDate,
      reason: REASON_LABELS[r.reason] ?? r.reason,
      status: r.status,
      notes: r.notes,
      reviewNote: r.reviewNote,
      totalDays: r.totalDays,
      submittedAt: r.submittedAt,
    })),
    ...overrides.map((o) => {
      const emp = staff.find((e) => e.id === o.employeeId);
      return {
        type: "manual" as const,
        employeeId: o.employeeId,
        employeeName: emp?.name ?? `Employee #${o.employeeId}`,
        date: o.date,
        reason: REASON_LABELS[o.reason as LeaveReason] ?? o.reason,
        status: "manual",
      };
    }),
  ].sort((a, b) => ((b as any).startDate ?? (b as any).date ?? "").localeCompare((a as any).startDate ?? (a as any).date ?? ""));

  const filteredAbsences = allAbsences.filter((a) => {
    if (filterEmployee && a.employeeId !== Number(filterEmployee)) return false;
    if (filterMonth) {
      const date = a.startDate ?? a.date ?? "";
      if (!date.startsWith(filterMonth)) return false;
    }
    return true;
  });

  const summaryByEmployee = staff.map((emp) => {
    const empRequests = requests.filter((r) => r.employeeId === emp.id);
    const empOverrides = overrides.filter((o) => o.employeeId === emp.id);
    const approved = empRequests.filter((r) => r.status === "approved").reduce((s, r) => s + (r.totalDays ?? 1), 0);
    const pending = empRequests.filter((r) => r.status === "pending").length;
    // Only count manual overrides that don't overlap with approved leave requests
    const approvedDates = new Set(
      empRequests
        .filter((r) => r.status === "approved")
        .flatMap((r) => {
          const dates: string[] = [];
          const cur = new Date(r.startDate + "T00:00:00");
          const end = new Date(r.endDate + "T00:00:00");
          while (cur <= end) { dates.push(cur.toISOString().split("T")[0]); cur.setDate(cur.getDate() + 1); }
          return dates;
        })
    );
    const manual = empOverrides.filter((o) => !approvedDates.has(o.date)).length;
    return { emp, approved, pending, manual, total: approved + manual };
  }).filter((s) => s.total > 0 || s.pending > 0);

  const months: string[] = [];
  const now = new Date();
  for (let i = -2; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push(d.toISOString().slice(0, 7));
  }

  const calDays = generateMonth(calYear, calMonth);
  const calFirstDow = new Date(calYear, calMonth - 1, 1).getDay();
  const calBlanks = Array.from({ length: calFirstDow });

  const leaveByDate = useMemo(() => {
    const map: Record<string, { employeeId: number; employeeName: string; status: "approved" | "pending"; reason: string }[]> = {};
    const visible = requests.filter((r) => r.status === "approved" || r.status === "pending");
    for (const r of visible) {
      const cur = new Date(r.startDate + "T00:00:00");
      const end = new Date(r.endDate + "T00:00:00");
      while (cur <= end) {
        const dateStr = cur.toISOString().split("T")[0];
        if (!map[dateStr]) map[dateStr] = [];
        map[dateStr].push({ employeeId: r.employeeId, employeeName: r.employeeName, status: r.status as "approved" | "pending", reason: REASON_LABELS[r.reason] ?? r.reason });
        cur.setDate(cur.getDate() + 1);
      }
    }
    return map;
  }, [requests]);

  function prevCalMonth() {
    if (calMonth === 1) { setCalYear((y) => y - 1); setCalMonth(12); } else setCalMonth((m) => m - 1);
  }
  function nextCalMonth() {
    if (calMonth === 12) { setCalYear((y) => y + 1); setCalMonth(1); } else setCalMonth((m) => m + 1);
  }

  return (
    <div className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-white shadow-sm sticky top-0 z-50">
        <div>
          <div style={{ fontWeight: 700, color: "#5a5a5a", fontSize: 16 }}>deccan<span style={{ color: "#e8622a" }}>|</span>dental</div>
          <div style={{ fontSize: 10, color: "#9a9a9a", letterSpacing: "0.1em" }}>LEAVE & ABSENCES</div>
        </div>
        <button onClick={() => setMenuOpen(!menuOpen)} style={{ fontSize: 22, color: "#5a5a5a" }}>☰</button>
      </div>

      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black bg-opacity-40" onClick={() => setMenuOpen(false)}>
          <div className="bg-white w-64 h-full p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-6">
              <div style={{ fontWeight: 700, fontSize: 18, color: "#5a5a5a" }}>deccan<span style={{ color: "#e8622a" }}>|</span>dental</div>
              <div style={{ fontSize: 11, color: "#9a9a9a" }}>Sleep Center</div>
            </div>
            {[
              { label: "📅 Calendar", href: "/" },
              { label: "✏️ Schedule Builder", href: "/schedule-builder" },
              { label: "🏥 Availability", href: "/availability" },
              { label: "👥 Staff", href: "/staff" },
              { label: "📝 Leave Request", href: "/leave" },
              { label: "🔐 Manage Leave", href: "/leave/manage" },
              { label: "🏖️ Holidays & Closures", href: "/holidays" },
              { label: "🔄 Temp Staff", href: "/temps" },
            ].map((item) => (
              <a key={item.href} href={item.href} className="block rounded-xl px-4 py-3 text-sm font-medium mb-1"
                style={{ color: item.href === "/leave" ? "white" : "#6b7280", backgroundColor: item.href === "/leave" ? "#e8622a" : "transparent" }}>
                {item.label}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="hidden lg:block"><Sidebar /></div>

      <div className="lg:ml-64 p-4 lg:p-8">
        <div className="mb-6">
          <h1 className="text-2xl lg:text-3xl font-bold" style={{ color: "#5a5a5a" }}>Leave & Absences</h1>
          <p className="mt-1 text-gray-400 text-sm">Submit and track your leave requests</p>
        </div>

        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {[
            { key: "request", label: "📝 New Request" },
            { key: "my", label: "📋 My Requests" },
            { key: "calendar", label: "🗓️ Calendar" },
            { key: "all", label: "📊 All Absences" },
          ].map((tab) => (
            <button key={tab.key} onClick={() => setView(tab.key as any)}
              className="rounded-xl px-4 py-2 text-sm font-semibold transition whitespace-nowrap flex-shrink-0"
              style={view === tab.key ? { backgroundColor: "#e8622a", color: "white" } : { background: "white", color: "#6b7280", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
              {tab.label}
            </button>
          ))}
        </div>

        {view === "request" && (
          <div className="max-w-lg mx-auto lg:mx-0">
            {submitted ? (
              <div className="rounded-2xl bg-white p-8 shadow text-center">
                <div className="text-5xl mb-4">✅</div>
                <h2 className="text-xl font-bold mb-2" style={{ color: "#5a5a5a" }}>Request Submitted!</h2>
                <p className="text-gray-400 mb-6 text-sm">Your request has been sent to Dr. Nanjapa for approval.</p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <button onClick={() => { setSubmitted(false); setForm({ ...form, startDate: "", endDate: "", notes: "", isPartialDay: false, partialHours: "" }); }}
                    className="rounded-xl px-6 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: "#e8622a" }}>Submit Another</button>
                  <button onClick={() => setView("my")} className="rounded-xl border border-gray-200 px-6 py-2.5 text-sm font-semibold text-gray-500 hover:bg-gray-50">View My Requests</button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-white p-5 lg:p-8 shadow space-y-5">
                <h2 className="text-lg font-bold" style={{ color: "#5a5a5a" }}>Submit a Leave Request</h2>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Your Name</label>
                  <select value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none" style={{ fontSize: 16 }}>
                    <option value="">Select your name...</option>
                    {staff.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.role}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Your Email</label>
                  <input type="email" value={form.employeeEmail} onChange={(e) => setForm((f) => ({ ...f, employeeEmail: e.target.value }))}
                    placeholder="your.email@mydeccandental.com" className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none" style={{ fontSize: 16 }} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">Start Date</label>
                    <input type="date" value={form.startDate} onChange={(e) => handleDateChange("startDate", e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm focus:outline-none" style={{ fontSize: 16 }} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">End Date</label>
                    <input type="date" value={form.endDate} onChange={(e) => handleDateChange("endDate", e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm focus:outline-none" style={{ fontSize: 16 }} />
                  </div>
                </div>
                {totalDays > 0 && (
                  <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-500">
                    📅 <strong>{totalDays} working day{totalDays !== 1 ? "s" : ""}</strong> selected
                  </div>
                )}
                <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
                  <p className="font-semibold mb-1">📋 Advance Notice Guidelines</p>
                  <ul className="space-y-0.5 text-xs text-blue-600">
                    <li>• More than 3 days → 4 weeks notice recommended</li>
                    <li>• More than 7 days → 6 weeks notice recommended</li>
                    <li>• More than 14 days → 8 weeks notice recommended</li>
                  </ul>
                  {noticeWarning && <p className="text-xs text-amber-600 mt-2 font-medium">⚠️ {noticeWarning}</p>}
                </div>
                <div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={form.isPartialDay} onChange={(e) => setForm((f) => ({ ...f, isPartialDay: e.target.checked }))} className="h-5 w-5 rounded" />
                    <span className="text-sm font-medium text-gray-500">Partial day(s)</span>
                  </label>
                  {form.isPartialDay && (
                    <input type="text" value={form.partialHours} onChange={(e) => setForm((f) => ({ ...f, partialHours: e.target.value }))}
                      placeholder="e.g. Morning only, or 8:30am – 1pm" className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none" style={{ fontSize: 16 }} />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-2">Reason</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.entries(REASON_LABELS) as [LeaveReason, string][]).map(([key, label]) => (
                      <button key={key} onClick={() => setForm((f) => ({ ...f, reason: key }))}
                        className="rounded-xl border px-3 py-3 text-sm font-medium transition text-left"
                        style={form.reason === key ? { backgroundColor: "#e8622a", borderColor: "#e8622a", color: "white" } : { borderColor: "#e5e7eb", color: "#6b7280" }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Notes <span className="text-gray-300">(optional)</span></label>
                  <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={3} placeholder="Any additional details..." className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none resize-none" style={{ fontSize: 16 }} />
                </div>
                {error && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">🔴 {error}</div>}
                <button onClick={handleSubmit} className="w-full rounded-xl py-4 font-semibold text-white transition hover:opacity-90 text-base" style={{ backgroundColor: "#e8622a" }}>
                  Submit Leave Request
                </button>
              </div>
            )}
          </div>
        )}

        {view === "my" && (
          <div className="max-w-lg mx-auto lg:mx-0">
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-500 mb-1">Select your name</label>
              <select value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none" style={{ fontSize: 16 }}>
                <option value="">Select name...</option>
                {staff.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            {form.employeeId && (
              <div className="space-y-3">
                {myRequests.length === 0 ? (
                  <div className="rounded-2xl bg-white p-8 text-center shadow"><p className="text-gray-400">No leave requests found.</p></div>
                ) : myRequests.map((req) => (
                  <div key={req.id} className="rounded-2xl bg-white p-5 shadow">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="font-semibold" style={{ color: "#5a5a5a" }}>
                          {new Date(req.startDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          {req.startDate !== req.endDate && ` – ${new Date(req.endDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
                          {req.startDate === req.endDate && `, ${new Date(req.startDate + "T00:00:00").getFullYear()}`}
                        </div>
                        <div className="text-sm text-gray-400 mt-0.5">{REASON_LABELS[req.reason]} · {req.totalDays} day{req.totalDays !== 1 ? "s" : ""}</div>
                        {req.notes && <div className="text-sm text-gray-400 italic mt-1">"{req.notes}"</div>}
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold flex-shrink-0 ml-2 ${STATUS_STYLES[req.status]}`}>
                        {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                      </span>
                    </div>
                    {req.reviewNote && <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500 mb-3"><span className="font-medium">Manager note:</span> {req.reviewNote}</div>}
                    <div className="flex items-center justify-between text-xs text-gray-300">
                      <span>Submitted {new Date(req.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                      {req.status === "pending" && <button onClick={async () => { await cancelLeaveRequest(req.id); await refresh(); }} className="text-red-400 hover:text-red-600 font-medium">Cancel</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {view === "calendar" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <button onClick={prevCalMonth} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-500 hover:bg-gray-50 transition shadow-sm">←</button>
                <span className="text-lg font-bold min-w-[160px] text-center" style={{ color: "#5a5a5a" }}>{formatMonthYear(calYear, calMonth)}</span>
                <button onClick={nextCalMonth} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-500 hover:bg-gray-50 transition shadow-sm">→</button>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span>Colors = staff member</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-green-400 border border-white" /> Approved</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-400 border border-white" /> Pending</span>
              </div>
            </div>

            <div className="rounded-2xl bg-white p-4 lg:p-6 shadow">
              <div className="grid grid-cols-7 mb-2">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((h) => (
                  <div key={h} className="py-1 text-center text-xs font-semibold uppercase tracking-wide text-gray-400">{h}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {calBlanks.map((_, i) => <div key={`b${i}`} />)}
                {calDays.map((day) => {
                  const entries = leaveByDate[day.date] ?? [];
                  const isToday = day.date === today0.toISOString().split("T")[0];
                  return (
                    <div key={day.date}
                      className={`rounded-xl border p-1.5 text-left min-h-[70px] sm:min-h-[90px] flex flex-col ${isToday ? "border-cyan-400 bg-cyan-50" : "border-gray-100 bg-gray-50"}`}>
                      <div className={`text-xs font-bold mb-1 ${isToday ? "text-cyan-600" : "text-gray-400"}`}>{day.day}</div>
                      <div className="flex flex-wrap gap-1">
                        {entries.map((e, i) => {
                          const emp = staff.find((s) => s.id === e.employeeId);
                          return (
                            <div key={i} className="relative h-5 w-5 sm:h-6 sm:w-6 flex-shrink-0"
                              title={`${e.employeeName} — ${e.reason} (${e.status})`}>
                              <div className="h-full w-full rounded-full flex items-center justify-center text-white font-bold text-[9px] sm:text-[10px]"
                                style={{ backgroundColor: emp?.color ?? "#9ca3af" }}>
                                {e.employeeName.charAt(0)}
                              </div>
                              <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-white ${
                                e.status === "approved" ? "bg-green-500" : "bg-amber-500"
                              }`} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {view === "all" && (
          <div>
            {!allAuthenticated ? (
              <div className="max-w-sm mx-auto mt-4">
                <div className="rounded-2xl bg-white p-8 shadow text-center">
                  <div className="text-4xl mb-3">🔐</div>
                  <h2 className="text-xl font-bold mb-1" style={{ color: "#5a5a5a" }}>Manager Access</h2>
                  <p className="text-gray-400 text-sm mb-6">Enter your passcode to view all staff absences</p>
                  <input type="password" value={allPasscode} onChange={(e) => setAllPasscode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { if (allPasscode === PASSCODE) setAllAuthenticated(true); else { setAllPasscodeError(true); setAllPasscode(""); } } }}
                    placeholder="Enter passcode" maxLength={6}
                    className={`w-full rounded-xl border px-4 py-3 text-center text-xl tracking-widest font-bold focus:outline-none mb-3 ${allPasscodeError ? "border-red-300 bg-red-50" : "border-gray-200"}`} style={{ fontSize: 24 }} />
                  {allPasscodeError && <p className="text-red-500 text-sm mb-3">Incorrect passcode.</p>}
                  <button onClick={() => { if (allPasscode === PASSCODE) setAllAuthenticated(true); else { setAllPasscodeError(true); setAllPasscode(""); } }}
                    className="w-full rounded-xl py-3 font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>Unlock</button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {summaryByEmployee.length > 0 && (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {summaryByEmployee.map(({ emp, approved, pending, manual }) => (
                      <div key={emp.id} className="rounded-2xl bg-white p-4 shadow">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="h-7 w-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: emp.color }}>{emp.name.charAt(0)}</div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold truncate" style={{ color: "#5a5a5a" }}>{emp.name}</div>
                            <div className="text-xs text-gray-400">{emp.role}</div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1 text-xs">
                          {approved > 0 && <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5">{approved}d approved</span>}
                          {pending > 0 && <span className="rounded-full bg-amber-100 text-amber-700 px-2 py-0.5">{pending} pending</span>}
                          {manual > 0 && <span className="rounded-full bg-purple-100 text-purple-700 px-2 py-0.5">{manual}d marked</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <select value={filterEmployee} onChange={(e) => setFilterEmployee(e.target.value)}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none bg-white shadow flex-1" style={{ fontSize: 16 }}>
                    <option value="">All Staff</option>
                    {staff.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                  <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none bg-white shadow flex-1" style={{ fontSize: 16 }}>
                    <option value="">All Months</option>
                    {months.map((m) => <option key={m} value={m}>{new Date(m + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" })}</option>)}
                  </select>
                </div>
                <div className="space-y-3">
                  {filteredAbsences.length === 0 ? (
                    <div className="rounded-2xl bg-white p-8 text-center shadow"><p className="text-gray-300">No absences found</p></div>
                  ) : filteredAbsences.map((a, i) => {
                    const emp = staff.find((e) => e.id === a.employeeId);
                    const dateStr = a.date
                      ? new Date(a.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                      : a.startDate === a.endDate
                      ? new Date((a.startDate ?? "") + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                      : `${new Date((a.startDate ?? "") + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date((a.endDate ?? "") + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
                    return (
                      <div key={i} className="rounded-2xl bg-white p-4 shadow">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: emp?.color ?? "#888" }}>{a.employeeName.charAt(0)}</div>
                            <div>
                              <div className="font-semibold text-sm" style={{ color: "#5a5a5a" }}>{a.employeeName}</div>
                              <div className="text-xs text-gray-400">{dateStr}{a.totalDays && a.totalDays > 1 ? ` · ${a.totalDays} days` : ""}</div>
                            </div>
                          </div>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold flex-shrink-0 ml-2 ${STATUS_STYLES[a.status ?? "manual"]}`}>
                            {a.status === "manual" ? "Marked" : (a.status ?? "").charAt(0).toUpperCase() + (a.status ?? "").slice(1)}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2">
                          <span className="text-xs text-gray-500">{a.reason}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.type === "manual" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                            {a.type === "manual" ? "Manually marked" : "Leave request"}
                          </span>
                        </div>
                        {(a.notes || a.reviewNote) && <p className="text-xs text-gray-400 italic mt-1">"{a.notes || a.reviewNote}"</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
