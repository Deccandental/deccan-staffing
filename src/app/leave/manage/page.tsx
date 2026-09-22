"use client";

import { useState, useEffect, Fragment } from "react";
import { Sidebar } from "@/components/Sidebar";
import AppIdentityGate from "@/components/AppIdentityGate";
import AccessDenied from "@/components/AccessDenied";
import { LeaveRequest, LeaveReason } from "@/types/leave";
import { loadLeaveRequests, updateLeaveStatus, deleteLeaveRequest, countBusinessDays, isPaidLeaveReason } from "@/lib/leaveStore";
import { setUnavailable, clearUnavailable } from "@/lib/overrides";
import { adjustLeaveBalance } from "@/lib/staffStore";
import { supabase } from "@/lib/supabase";

const REASON_LABELS: Record<LeaveReason, string> = {
  sick: "Paid Sick Leave", pto: "PTO", leave: "Unpaid Personal Leave", other: "Other",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  denied: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-400",
};

function LeaveManagePageBody() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ startDate: string; endDate: string }>({ startDate: "", endDate: "" });
  const [sendingPayroll, setSendingPayroll] = useState(false);
  const [payrollMessage, setPayrollMessage] = useState("");
  const [sortField, setSortField] = useState<"date" | "name" | "reason" | "status" | "days">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function handleSendPayrollSummary() {
    setSendingPayroll(true);
    setPayrollMessage("");
    try {
      const res = await fetch("/api/leave/payroll-summary", { method: "POST" });
      const data = await res.json();
      setPayrollMessage(data.sent ? "Payroll summary email sent." : "Could not send the email — check that RESEND_API_KEY is set.");
    } catch {
      setPayrollMessage("Something went wrong sending the email.");
    }
    setSendingPayroll(false);
  }

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    const data = await loadLeaveRequests();
    setRequests(data);
  }

  async function applyToAvailability(req: LeaveRequest) {
    const CLOSED = new Set([0, 6]);
    const cur = new Date(req.startDate + "T00:00:00");
    const end = new Date(req.endDate + "T00:00:00");
    while (cur <= end) {
      if (!CLOSED.has(cur.getDay())) {
        await setUnavailable(req.employeeId, cur.toISOString().split("T")[0], req.reason as any);
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  async function removeFromAvailability(req: LeaveRequest) {
    const CLOSED = new Set([0, 6]);
    const cur = new Date(req.startDate + "T00:00:00");
    const end = new Date(req.endDate + "T00:00:00");
    while (cur <= end) {
      if (!CLOSED.has(cur.getDay())) {
        await clearUnavailable(req.employeeId, cur.toISOString().split("T")[0]);
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  async function handleApprove(req: LeaveRequest) {
    setProcessing(req.id);
    const note = reviewNote[req.id] ?? "";
    await updateLeaveStatus(req.id, "approved", note);
    await applyToAvailability(req);
    if (isPaidLeaveReason(req.reason)) {
      const hours = req.paidHours ?? req.totalDays * 8;
      await adjustLeaveBalance(req.employeeId, req.reason as "pto" | "sick", -hours);
    }
    try {
      await fetch("/api/leave/notify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: { ...req, status: "approved", reviewNote: note }, type: "approved" }),
      });
    } catch {}
    setProcessing(null);
    await refresh();
  }

  async function handleDeny(req: LeaveRequest) {
    setProcessing(req.id);
    const note = reviewNote[req.id] ?? "";
    await updateLeaveStatus(req.id, "denied", note);
    try {
      await fetch("/api/leave/notify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: { ...req, status: "denied", reviewNote: note }, type: "denied" }),
      });
    } catch {}
    setProcessing(null);
    await refresh();
  }

  async function handleCancel(req: LeaveRequest) {
    setProcessing(req.id);
    if (req.status === "approved") {
      await removeFromAvailability(req);
      if (isPaidLeaveReason(req.reason)) {
        const hours = req.paidHours ?? req.totalDays * 8;
        await adjustLeaveBalance(req.employeeId, req.reason as "pto" | "sick", hours);
      }
    }
    await updateLeaveStatus(req.id, "cancelled");
    setProcessing(null);
    await refresh();
  }

  async function handleDelete(req: LeaveRequest) {
    if (!confirm(`Permanently delete this request from ${req.employeeName}? This can't be undone.`)) return;
    setProcessing(req.id);
    await deleteLeaveRequest(req.id);
    setProcessing(null);
    await refresh();
  }

  function startEdit(req: LeaveRequest) {
    setEditing(req.id);
    setEditForm({ startDate: req.startDate, endDate: req.endDate });
  }

  async function handleSaveEdit(req: LeaveRequest) {
    setProcessing(req.id);
    const totalDays = countBusinessDays(editForm.startDate, editForm.endDate);
    if (req.status === "approved") {
      await removeFromAvailability(req);
    }
    const { error } = await supabase.from("leave_requests").update({
      start_date: editForm.startDate,
      end_date: editForm.endDate,
      total_days: totalDays,
    }).eq("id", req.id);
    if (error) console.error("handleSaveEdit error:", error);
    if (req.status === "approved") {
      await applyToAvailability({ ...req, startDate: editForm.startDate, endDate: editForm.endDate });
    }
    setEditing(null);
    setProcessing(null);
    await refresh();
  }

  function toggleSort(field: "date" | "name" | "reason" | "status" | "days") {
    if (sortField === field) { setSortDir((d) => (d === "asc" ? "desc" : "asc")); }
    else { setSortField(field); setSortDir("asc"); }
  }

  const filtered = requests
    .filter((r) => filter === "pending" ? r.status === "pending" : true)
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === "date") cmp = a.startDate.localeCompare(b.startDate);
      else if (sortField === "name") cmp = a.employeeName.localeCompare(b.employeeName);
      else if (sortField === "reason") cmp = REASON_LABELS[a.reason].localeCompare(REASON_LABELS[b.reason]);
      else if (sortField === "status") cmp = a.status.localeCompare(b.status);
      else if (sortField === "days") cmp = a.totalDays - b.totalDays;
      return sortDir === "asc" ? cmp : -cmp;
    });
  const pendingCount = requests.filter((r) => r.status === "pending").length;

  function sortArrow(field: typeof sortField) {
    if (sortField !== field) return <span style={{ opacity: 0.3 }}>↕</span>;
    return <span>{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-24 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: "#5a5a5a" }}>Leave Management</h1>
            <p className="mt-1 text-gray-400">{pendingCount > 0 ? `${pendingCount} pending request${pendingCount !== 1 ? "s" : ""} awaiting review` : "No pending requests"}</p>
          </div>
          <div className="flex items-center gap-2">
            {payrollMessage && <span className="text-xs text-slate-400 max-w-[200px]">{payrollMessage}</span>}
            <button onClick={handleSendPayrollSummary} disabled={sendingPayroll}
              className="rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-50"
              style={{ background: "white", color: "#6b7280", border: "1px solid #e5e7eb" }}>
              {sendingPayroll ? "Sending…" : "📧 Send Payroll Summary Now"}
            </button>
            <button onClick={() => setFilter("pending")} className="rounded-xl px-4 py-2 text-sm font-semibold transition"
              style={filter === "pending" ? { backgroundColor: "#e8622a", color: "white" } : { background: "white", color: "#6b7280" }}>
              Pending {pendingCount > 0 && <span className="ml-1 rounded-full bg-white px-1.5 text-xs" style={{ color: "#e8622a" }}>{pendingCount}</span>}
            </button>
            <button onClick={() => setFilter("all")} className="rounded-xl px-4 py-2 text-sm font-semibold transition"
              style={filter === "all" ? { backgroundColor: "#e8622a", color: "white" } : { background: "white", color: "#6b7280" }}>
              All Requests
            </button>
          </div>
        </div>

        <div className="max-w-6xl">
          {filtered.length === 0 ? (
            <div className="rounded-2xl bg-white p-10 text-center shadow">
              <div className="text-4xl mb-3">✅</div>
              <p className="text-gray-400">No {filter === "pending" ? "pending" : ""} requests.</p>
            </div>
          ) : (
            <div className="rounded-2xl bg-white shadow overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    <th className="px-4 py-3">
                      <button onClick={() => toggleSort("date")} className="flex items-center gap-1 text-xs font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-600">
                        Dates {sortArrow("date")}
                      </button>
                    </th>
                    <th className="px-4 py-3">
                      <button onClick={() => toggleSort("name")} className="flex items-center gap-1 text-xs font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-600">
                        Name {sortArrow("name")}
                      </button>
                    </th>
                    <th className="px-4 py-3">
                      <button onClick={() => toggleSort("reason")} className="flex items-center gap-1 text-xs font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-600">
                        Reason {sortArrow("reason")}
                      </button>
                    </th>
                    <th className="px-4 py-3">
                      <button onClick={() => toggleSort("days")} className="flex items-center gap-1 text-xs font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-600">
                        Days {sortArrow("days")}
                      </button>
                    </th>
                    <th className="px-4 py-3">
                      <button onClick={() => toggleSort("status")} className="flex items-center gap-1 text-xs font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-600">
                        Status {sortArrow("status")}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide sticky right-0 bg-white shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.1)]">Manage</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((req) => (
                    <Fragment key={req.id}>
                      <tr key={req.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="font-medium" style={{ color: "#5a5a5a" }}>
                            {(() => {
                              const startYear = req.startDate.slice(0, 4);
                              const endYear = req.endDate.slice(0, 4);
                              const crossesYear = startYear !== endYear;
                              const startLabel = new Date(req.startDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: crossesYear ? "numeric" : undefined });
                              if (req.startDate === req.endDate) {
                                return new Date(req.startDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                              }
                              const endLabel = new Date(req.endDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                              return `${startLabel} – ${endLabel}`;
                            })()}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0" style={{ backgroundColor: "#e8622a" }}>
                              {req.employeeName.charAt(0)}
                            </div>
                            <span className="font-medium" style={{ color: "#5a5a5a" }}>{req.employeeName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div style={{ color: "#5a5a5a" }}>{REASON_LABELS[req.reason]}</div>
                          {req.isPartialDay && <div className="text-xs text-gray-400">{req.partialHours || "Partial day"}</div>}
                        </td>
                        <td className="px-4 py-3 text-gray-500">{req.totalDays}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[req.status]}`}>
                            {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                          </span>
                        </td>
                        <td className="px-4 py-3 sticky right-0 bg-white shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.1)]">
                          <button onClick={() => setExpandedId(expandedId === req.id ? null : req.id)} className="text-xs font-semibold hover:underline" style={{ color: "#e8622a" }}>
                            {expandedId === req.id ? "Hide" : "Manage"}
                          </button>
                        </td>
                      </tr>
                      {expandedId === req.id && (
                        <tr key={`${req.id}-detail`} className="border-b border-gray-100 bg-gray-50/60">
                          <td colSpan={6} className="px-4 py-4">
                            <div className="sticky left-0 w-[calc(100vw-3rem)] max-w-2xl">
                            <div className="text-xs text-gray-400 mb-3">{req.employeeEmail} · Submitted {new Date(req.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>

                            {editing === req.id ? (
                              <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 mb-3 space-y-3">
                                <p className="text-sm font-semibold text-blue-700">Edit Dates</p>
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
                                    <input type="date" value={editForm.startDate}
                                      onChange={(e) => setEditForm((f) => ({ ...f, startDate: e.target.value }))}
                                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none" />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
                                    <input type="date" value={editForm.endDate}
                                      onChange={(e) => setEditForm((f) => ({ ...f, endDate: e.target.value }))}
                                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none" />
                                  </div>
                                </div>
                                {editForm.startDate && editForm.endDate && (
                                  <p className="text-xs text-gray-500">📅 {countBusinessDays(editForm.startDate, editForm.endDate)} working days</p>
                                )}
                                <div className="flex gap-2">
                                  <button onClick={() => handleSaveEdit(req)} disabled={processing === req.id}
                                    className="rounded-xl px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                                    style={{ backgroundColor: "#e8622a" }}>
                                    {processing === req.id ? "Saving..." : "Save Changes"}
                                  </button>
                                  <button onClick={() => setEditing(null)}
                                    className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-50">
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : null}

                            {req.notes && <div className="mb-3 rounded-xl border border-gray-100 bg-white px-4 py-3 text-sm text-gray-500 italic">"{req.notes}"</div>}

                            {req.status === "pending" && editing !== req.id && (
                              <div className="space-y-3">
                                <textarea value={reviewNote[req.id] ?? ""} onChange={(e) => setReviewNote((n) => ({ ...n, [req.id]: e.target.value }))}
                                  placeholder="Add a note (optional)..." rows={2}
                                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none resize-none bg-white" />
                                <div className="flex flex-wrap gap-3">
                                  <button onClick={() => handleApprove(req)} disabled={processing === req.id}
                                    className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                                    style={{ backgroundColor: "#16a34a" }}>
                                    {processing === req.id ? "Processing..." : "✓ Approve"}
                                  </button>
                                  <button onClick={() => handleDeny(req)} disabled={processing === req.id}
                                    className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 bg-red-500">
                                    {processing === req.id ? "Processing..." : "✕ Deny"}
                                  </button>
                                  <button onClick={() => startEdit(req)} disabled={processing === req.id}
                                    className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-500 hover:bg-white disabled:opacity-50">
                                    ✏️ Edit
                                  </button>
                                  <button onClick={() => handleDelete(req)} disabled={processing === req.id}
                                    className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-400 hover:bg-white disabled:opacity-50">
                                    {processing === req.id ? "Deleting..." : "🗑 Delete"}
                                  </button>
                                </div>
                              </div>
                            )}

                            {(req.status === "approved" || req.status === "denied") && editing !== req.id && (
                              <div className="flex gap-2">
                                <button onClick={() => startEdit(req)} disabled={processing === req.id}
                                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-500 hover:bg-white disabled:opacity-50">
                                  ✏️ Edit Dates
                                </button>
                                <button onClick={() => handleCancel(req)} disabled={processing === req.id}
                                  className="rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-50 disabled:opacity-50">
                                  {processing === req.id ? "Cancelling..." : "✕ Cancel Request"}
                                </button>
                                <button onClick={() => handleDelete(req)} disabled={processing === req.id}
                                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-400 hover:bg-white disabled:opacity-50">
                                  {processing === req.id ? "Deleting..." : "🗑 Delete"}
                                </button>
                              </div>
                            )}

                            {req.status === "cancelled" && (
                              <div className="flex gap-2">
                                <button onClick={() => handleDelete(req)} disabled={processing === req.id}
                                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-400 hover:bg-white disabled:opacity-50">
                                  {processing === req.id ? "Deleting..." : "🗑 Delete permanently"}
                                </button>
                              </div>
                            )}

                            {req.reviewNote && req.status !== "pending" && (
                              <div className="rounded-lg bg-white px-3 py-2 text-sm text-gray-500 mt-3">
                                <span className="font-medium">Note:</span> {req.reviewNote}
                              </div>
                            )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function LeaveManagePage() {
  return (
    <AppIdentityGate>
      {(identity, logout) => identity.canManageLeave ? <LeaveManagePageBody /> : <AccessDenied logout={logout} />}
    </AppIdentityGate>
  );
}
