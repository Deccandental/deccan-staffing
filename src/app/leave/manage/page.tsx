"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { LeaveRequest, LeaveReason } from "@/types/leave";
import { loadLeaveRequests, updateLeaveStatus } from "@/lib/leaveStore";
import { setUnavailable } from "@/lib/overrides";

const PASSCODE = "2503";

const REASON_LABELS: Record<LeaveReason, string> = {
  sick: "Sick Leave", pto: "PTO / Vacation", leave: "Personal Leave", other: "Other",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  denied: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-400",
};

export default function LeaveManagePage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [passcodeError, setPasscodeError] = useState(false);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => { if (authenticated) refresh(); }, [authenticated]);
  function refresh() { setRequests(loadLeaveRequests()); }

  function handlePasscode() {
    if (passcode === PASSCODE) { setAuthenticated(true); setPasscodeError(false); }
    else { setPasscodeError(true); setPasscode(""); }
  }

  function applyToAvailability(req: LeaveRequest) {
    const CLOSED = new Set([0, 6]); // 0 = Sunday, 6 = Saturday
    const cur = new Date(req.startDate + "T00:00:00");
    const end = new Date(req.endDate + "T00:00:00");
    while (cur <= end) {
      if (!CLOSED.has(cur.getDay())) {
        setUnavailable(req.employeeId, cur.toISOString().split("T")[0], req.reason as any);
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  async function handleApprove(req: LeaveRequest) {
    setProcessing(req.id);
    const note = reviewNote[req.id] ?? "";
    updateLeaveStatus(req.id, "approved", note);
    applyToAvailability(req);
    try { await fetch("/api/leave/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request: { ...req, status: "approved", reviewNote: note }, type: "approved" }) }); } catch {}
    setProcessing(null);
    refresh();
  }

  async function handleDeny(req: LeaveRequest) {
    setProcessing(req.id);
    const note = reviewNote[req.id] ?? "";
    updateLeaveStatus(req.id, "denied", note);
    try { await fetch("/api/leave/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request: { ...req, status: "denied", reviewNote: note }, type: "denied" }) }); } catch {}
    setProcessing(null);
    refresh();
  }

  const filtered = requests
    .filter((r) => filter === "pending" ? r.status === "pending" : true)
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  const pendingCount = requests.filter((r) => r.status === "pending").length;

  if (!authenticated) {
    return (
      <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
        <Sidebar />
        <div className="ml-64 flex items-center justify-center min-h-screen">
          <div className="rounded-2xl bg-white p-10 shadow-lg w-full max-w-sm text-center">
            <div className="text-5xl mb-4">🔐</div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: "#5a5a5a" }}>Manager Access</h1>
            <p className="text-gray-400 text-sm mb-8">Enter your passcode to manage leave requests</p>
            <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handlePasscode()} placeholder="Enter passcode" maxLength={6} className={`w-full rounded-xl border px-4 py-3 text-center text-xl tracking-widest font-bold focus:outline-none mb-4 ${passcodeError ? "border-red-300 bg-red-50" : "border-gray-200"}`} />
            {passcodeError && <p className="text-red-500 text-sm mb-4">Incorrect passcode. Try again.</p>}
            <button onClick={handlePasscode} className="w-full rounded-xl py-3 font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>Unlock</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="ml-64 p-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: "#5a5a5a" }}>Leave Management</h1>
            <p className="mt-1 text-gray-400">{pendingCount > 0 ? `${pendingCount} pending request${pendingCount !== 1 ? "s" : ""} awaiting review` : "No pending requests"}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setFilter("pending")} className="rounded-xl px-4 py-2 text-sm font-semibold transition" style={filter === "pending" ? { backgroundColor: "#e8622a", color: "white" } : { background: "white", color: "#6b7280" }}>
              Pending {pendingCount > 0 && <span className="ml-1 rounded-full bg-white px-1.5 text-xs" style={{ color: "#e8622a" }}>{pendingCount}</span>}
            </button>
            <button onClick={() => setFilter("all")} className="rounded-xl px-4 py-2 text-sm font-semibold transition" style={filter === "all" ? { backgroundColor: "#e8622a", color: "white" } : { background: "white", color: "#6b7280" }}>All Requests</button>
          </div>
        </div>

        <div className="space-y-4 max-w-3xl">
          {filtered.length === 0 ? (
            <div className="rounded-2xl bg-white p-10 text-center shadow"><div className="text-4xl mb-3">✅</div><p className="text-gray-400">No {filter === "pending" ? "pending" : ""} requests.</p></div>
          ) : filtered.map((req) => (
            <div key={req.id} className="rounded-2xl bg-white p-6 shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: "#e8622a" }}>{req.employeeName.charAt(0)}</div>
                  <div>
                    <div className="font-bold" style={{ color: "#5a5a5a" }}>{req.employeeName}</div>
                    <div className="text-sm text-gray-400">{req.employeeEmail}</div>
                  </div>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[req.status]}`}>{req.status.charAt(0).toUpperCase() + req.status.slice(1)}</span>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-4 rounded-xl bg-gray-50 p-4 text-sm">
                <div>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Dates</div>
                  <div className="font-medium" style={{ color: "#5a5a5a" }}>
                    {new Date(req.startDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {req.startDate !== req.endDate && ` – ${new Date(req.endDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
                  </div>
                  <div className="text-xs text-gray-400">{req.totalDays} working day{req.totalDays !== 1 ? "s" : ""}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Reason</div>
                  <div className="font-medium" style={{ color: "#5a5a5a" }}>{REASON_LABELS[req.reason]}</div>
                  {req.isPartialDay && <div className="text-xs text-gray-400">{req.partialHours || "Partial day"}</div>}
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Submitted</div>
                  <div className="font-medium" style={{ color: "#5a5a5a" }}>{new Date(req.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
                </div>
              </div>

              {req.notes && <div className="mb-4 rounded-xl border border-gray-100 px-4 py-3 text-sm text-gray-500 italic">"{req.notes}"</div>}

              {req.status === "pending" && (
                <div className="space-y-3">
                  <textarea value={reviewNote[req.id] ?? ""} onChange={(e) => setReviewNote((n) => ({ ...n, [req.id]: e.target.value }))} placeholder="Add a note (optional)..." rows={2} className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none resize-none" />
                  <div className="flex gap-3">
                    <button onClick={() => handleApprove(req)} disabled={processing === req.id} className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "#16a34a" }}>
                      {processing === req.id ? "Processing..." : "✓ Approve"}
                    </button>
                    <button onClick={() => handleDeny(req)} disabled={processing === req.id} className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 bg-red-500">
                      {processing === req.id ? "Processing..." : "✕ Deny"}
                    </button>
                  </div>
                </div>
              )}
              {req.reviewNote && req.status !== "pending" && <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500"><span className="font-medium">Note:</span> {req.reviewNote}</div>}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
