"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { loadStaff } from "@/lib/staffStore";
import { Employee } from "@/types/employee";
import { LeaveReason, LeaveRequest } from "@/types/leave";
import { addLeaveRequest, loadLeaveRequests, cancelLeaveRequest, countBusinessDays, validateNoticePeriod } from "@/lib/leaveStore";

const REASON_LABELS: Record<LeaveReason, string> = {
  sick: "Sick Leave", pto: "PTO / Vacation", leave: "Personal Leave", other: "Other",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  denied: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-400",
};

export default function LeavePage() {
  const [staff, setStaff] = useState<Employee[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [view, setView] = useState<"request" | "my">("request");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [noticeWarning, setNoticeWarning] = useState("");
  const [form, setForm] = useState({ employeeId: "", employeeEmail: "", startDate: "", endDate: "", isPartialDay: false, partialHours: "", reason: "pto" as LeaveReason, notes: "" });

  useEffect(() => { setStaff(loadStaff()); setRequests(loadLeaveRequests()); }, []);
  function refresh() { setRequests(loadLeaveRequests()); }

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
    // Notice period is advisory only — no hard block

    const req = addLeaveRequest({
      employeeId: Number(form.employeeId), employeeName: selectedEmployee?.name ?? "",
      employeeEmail: form.employeeEmail, startDate: form.startDate, endDate: form.endDate,
      isPartialDay: form.isPartialDay, partialHours: form.partialHours,
      reason: form.reason, notes: form.notes, totalDays,
    });

    try {
      await fetch("/api/leave/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request: req, type: "submitted" }) });
    } catch {}

    setSubmitted(true);
    refresh();
  }

  const myRequests = requests.filter((r) => r.employeeId === Number(form.employeeId));

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="ml-64 p-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: "#5a5a5a" }}>Leave Requests</h1>
            <p className="mt-1 text-gray-400">Submit and track your leave requests</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setView("request")} className="rounded-xl px-4 py-2 text-sm font-semibold transition" style={view === "request" ? { backgroundColor: "#e8622a", color: "white" } : { background: "white", color: "#6b7280" }}>📝 New Request</button>
            <button onClick={() => setView("my")} className="rounded-xl px-4 py-2 text-sm font-semibold transition" style={view === "my" ? { backgroundColor: "#e8622a", color: "white" } : { background: "white", color: "#6b7280" }}>📋 My Requests</button>
          </div>
        </div>

        {view === "request" && (
          <div className="max-w-2xl">
            {submitted ? (
              <div className="rounded-2xl bg-white p-8 shadow text-center">
                <div className="text-5xl mb-4">✅</div>
                <h2 className="text-2xl font-bold mb-2" style={{ color: "#5a5a5a" }}>Request Submitted!</h2>
                <p className="text-gray-400 mb-6">Your request has been sent to Dr. Nanjapa for approval. You'll receive an email when it's reviewed.</p>
                <div className="flex gap-3 justify-center">
                  <button onClick={() => { setSubmitted(false); setForm({ ...form, startDate: "", endDate: "", notes: "", isPartialDay: false, partialHours: "" }); }} className="rounded-xl px-6 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: "#e8622a" }}>Submit Another</button>
                  <button onClick={() => setView("my")} className="rounded-xl border border-gray-200 px-6 py-2.5 text-sm font-semibold text-gray-500 hover:bg-gray-50">View My Requests</button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-white p-8 shadow space-y-6">
                <h2 className="text-xl font-bold" style={{ color: "#5a5a5a" }}>Submit a Leave Request</h2>

                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Your Name</label>
                  <select value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none">
                    <option value="">Select your name...</option>
                    {staff.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.role}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Your Email</label>
                  <input type="email" value={form.employeeEmail} onChange={(e) => setForm((f) => ({ ...f, employeeEmail: e.target.value }))} placeholder="your.email@mydeccandental.com" className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">Start Date</label>
                    <input type="date" value={form.startDate} onChange={(e) => handleDateChange("startDate", e.target.value)} className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">End Date</label>
                    <input type="date" value={form.endDate} onChange={(e) => handleDateChange("endDate", e.target.value)} className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none" />
                  </div>
                </div>

                {totalDays > 0 && <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-500">📅 <strong>{totalDays} working day{totalDays !== 1 ? "s" : ""}</strong> selected {totalDays > 3 && <span className="text-gray-400">(requires {totalDays > 14 ? "8" : totalDays > 7 ? "6" : "4"} weeks notice)</span>}</div>}
                {/* Advisory notice */}
                <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
                  <p className="font-semibold mb-1">📋 Advance Notice Guidelines</p>
                  <ul className="space-y-0.5 text-xs text-blue-600">
                    <li>• More than 3 days off → 4 weeks notice recommended</li>
                    <li>• More than 7 days off → 6 weeks notice recommended</li>
                    <li>• More than 14 days off → 8 weeks notice recommended</li>
                  </ul>
                  <p className="text-xs text-blue-500 mt-2 italic">Leave may not be approved if sufficient notice is not given.</p>
                  {noticeWarning && <p className="text-xs text-amber-600 mt-2 font-medium">⚠️ {noticeWarning}</p>}
                </div>

                <div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={form.isPartialDay} onChange={(e) => setForm((f) => ({ ...f, isPartialDay: e.target.checked }))} className="h-4 w-4 rounded" />
                    <span className="text-sm font-medium text-gray-500">Partial day(s)</span>
                  </label>
                  {form.isPartialDay && <input type="text" value={form.partialHours} onChange={(e) => setForm((f) => ({ ...f, partialHours: e.target.value }))} placeholder="e.g. Morning only, or 8:30am – 1pm" className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none" />}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-2">Reason</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.entries(REASON_LABELS) as [LeaveReason, string][]).map(([key, label]) => (
                      <button key={key} onClick={() => setForm((f) => ({ ...f, reason: key }))} className="rounded-xl border px-4 py-2.5 text-sm font-medium transition text-left" style={form.reason === key ? { backgroundColor: "#e8622a", borderColor: "#e8622a", color: "white" } : { borderColor: "#e5e7eb", color: "#6b7280" }}>{label}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Notes <span className="text-gray-300">(optional)</span></label>
                  <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={3} placeholder="Any additional details..." className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none resize-none" />
                </div>

                {error && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">🔴 {error}</div>}

                <button onClick={handleSubmit} className="w-full rounded-xl py-3 font-semibold text-white transition hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>Submit Leave Request</button>
              </div>
            )}
          </div>
        )}

        {view === "my" && (
          <div className="max-w-3xl">
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-500 mb-1">Select your name</label>
              <select value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none w-64">
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
                        </div>
                        <div className="text-sm text-gray-400">{REASON_LABELS[req.reason]} · {req.totalDays} day{req.totalDays !== 1 ? "s" : ""}{req.isPartialDay && req.partialHours && ` · ${req.partialHours}`}</div>
                        {req.notes && <div className="text-sm text-gray-400 italic mt-1">"{req.notes}"</div>}
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[req.status]}`}>{req.status.charAt(0).toUpperCase() + req.status.slice(1)}</span>
                    </div>
                    {req.reviewNote && <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500 mb-3"><span className="font-medium">Manager note:</span> {req.reviewNote}</div>}
                    <div className="flex items-center justify-between text-xs text-gray-300">
                      <span>Submitted {new Date(req.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                      {req.status === "pending" && <button onClick={() => { cancelLeaveRequest(req.id); refresh(); }} className="text-red-400 hover:text-red-600 font-medium">Cancel Request</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
