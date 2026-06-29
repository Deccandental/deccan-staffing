"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { LeaveRequest, LeaveReason } from "@/types/leave";
import { loadLeaveRequests, updateLeaveStatus, countBusinessDays } from "@/lib/leaveStore";
import { setUnavailable, clearUnavailable } from "@/lib/overrides";
import { supabase } from "@/lib/supabase";

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
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ startDate: string; endDate: string }>({ startDate: "", endDate: "" });

  useEffect(() => { if (authenticated) refresh(); }, [authenticated]);

  async function refresh() {
    const data = await loadLeaveRequests();
    setRequests(data);
  }

  function handlePasscode() {
    if (passcode === PASSCODE) { setAuthenticated(true); setPasscodeError(false); }
    else { setPasscodeError(true); setPasscode(""); }
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
    // If approved, remove from availability first
    if (req.status === "approved") {
      await removeFromAvailability(req);
    }
    await updateLeaveStatus(req.id, "cancelled");
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

    // If was approved, remove old availability overrides and add new ones
    if (req.status === "approved") {
      await removeFromAvailability(req);
    }

    // Update the leave request in Supabase
    const { error } = await supabase.from("leave_requests").update({
      start_date: editForm.startDate,
      end_date: editForm.endDate,
      total_days: totalDays,
    }).eq("id", req.id);

    if (error) console.error("handleSaveEdit error:", error);

    // If was approved, apply new availability overrides
    if (req.status === "approved") {
      await applyToAvailability({ ...req, startDate: editForm.startDate, endDate: editForm.endDate });
    }

    setEditing(null);
    setProcessing(null);
    await refresh();
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
            <h1 className="text-2xl font-bold mb-1" style={{ color:
