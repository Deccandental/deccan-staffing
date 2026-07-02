import { LeaveRequest, LeaveStatus } from "@/types/leave";
import { supabase } from "./supabase";

function rowToLeave(row: any): LeaveRequest {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    employeeEmail: row.employee_email,
    startDate: row.start_date,
    endDate: row.end_date,
    isPartialDay: row.is_partial_day ?? false,
    partialHours: row.partial_hours ?? "",
    reason: row.reason,
    notes: row.notes ?? "",
    totalDays: row.total_days,
    status: row.status,
    reviewNote: row.review_note ?? "",
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at ?? undefined,
  };
}

export async function loadLeaveRequests(): Promise<LeaveRequest[]> {
  const { data, error } = await supabase.from("leave_requests").select("*").order("submitted_at", { ascending: false });
  if (error) { console.error("loadLeaveRequests error:", error); return []; }
  return (data ?? []).map(rowToLeave);
}

export async function addLeaveRequest(req: Omit<LeaveRequest, "id" | "submittedAt" | "status">): Promise<LeaveRequest> {
  const id = `leave-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const { data, error } = await supabase.from("leave_requests").insert({
    id,
    employee_id: req.employeeId,
    employee_name: req.employeeName,
    employee_email: req.employeeEmail,
    start_date: req.startDate,
    end_date: req.endDate,
    is_partial_day: req.isPartialDay,
    partial_hours: req.partialHours,
    reason: req.reason,
    notes: req.notes,
    total_days: req.totalDays,
    status: "pending",
  }).select().single();
  if (error) { console.error("addLeaveRequest error:", error); throw error; }
  return rowToLeave(data);
}

export async function updateLeaveStatus(id: string, status: LeaveStatus, reviewNote?: string): Promise<void> {
  const { error } = await supabase.from("leave_requests").update({
    status, review_note: reviewNote ?? null, reviewed_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) console.error("updateLeaveStatus error:", error);
}

export async function cancelLeaveRequest(id: string): Promise<void> {
  const { error } = await supabase.from("leave_requests").update({ status: "cancelled" }).eq("id", id).eq("status", "pending");
  if (error) console.error("cancelLeaveRequest error:", error);
}

export function countBusinessDays(start: string, end: string): number {
  const CLOSED = new Set([0, 6]);
  let count = 0;
  const cur = new Date(start + "T00:00:00");
  const endDate = new Date(end + "T00:00:00");
  while (cur <= endDate) {
    if (!CLOSED.has(cur.getDay())) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

export function validateNoticePeriod(startDate: string, totalDays: number): string | null {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(startDate + "T00:00:00");
  const weeksNotice = (start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 7);
  if (totalDays > 14 && weeksNotice < 8) return `Requests over 14 days require 8 weeks notice. You have ${weeksNotice.toFixed(1)} weeks.`;
  if (totalDays > 7 && weeksNotice < 6) return `Requests over 7 days require 6 weeks notice. You have ${weeksNotice.toFixed(1)} weeks.`;
  if (totalDays > 3 && weeksNotice < 4) return `Requests over 3 days require 4 weeks notice. You have ${weeksNotice.toFixed(1)} weeks.`;
  return null;
}
