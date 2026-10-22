import { LeaveRequest, LeaveStatus, LeaveReason } from "@/types/leave";
import { supabase } from "./supabase";

function rowToLeave(row: any): LeaveRequest {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    employeeEmail: row.employee_email,
    startDate: row.start_date,
    endDate: row.end_date,
    startsMidday: row.starts_midday ?? false,
    endsMidday: row.ends_midday ?? false,
    isPartialDay: (row.starts_midday ?? false) || (row.ends_midday ?? false) || (row.is_partial_day ?? false),
    partialHours: row.partial_hours ?? "",
    reason: row.reason,
    notes: row.notes ?? "",
    totalDays: row.total_days,
    paidHours: row.paid_hours ?? undefined,
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
    starts_midday: req.startsMidday,
    ends_midday: req.endsMidday,
    is_partial_day: req.startsMidday || req.endsMidday,
    partial_hours: req.partialHours ?? "",
    reason: req.reason,
    notes: req.notes,
    total_days: req.totalDays,
    paid_hours: req.paidHours ?? null,
    status: "pending",
  }).select().single();
  if (error) { console.error("addLeaveRequest error:", error); throw error; }
  return rowToLeave(data);
}

// "pto" and "sick" are the only paid leave reasons that draw down a balance.
export function isPaidLeaveReason(reason: LeaveReason): boolean {
  return reason === "pto" || reason === "sick";
}

// Sensible default for the editable "hours to be paid" field. totalDays now
// already carries any half days as .5, so a flat 8 hours a day gives the
// right answer for both — 2.5 days is 20 hours. Staff can still adjust it.
export function computeDefaultPaidHours(totalDays: number): number {
  return totalDays * 8;
}

/**
 * Working days in a request, counting a half day as 0.5.
 *
 * Previously a morning off still counted as a whole day, so a half day of
 * PTO cost a full day of balance.
 */
export function countLeaveDays(start: string, end: string, startsMidday: boolean, endsMidday: boolean): number {
  const full = countBusinessDays(start, end);
  if (full <= 0) return 0;
  let days = full;
  if (startsMidday) days -= 0.5;
  if (endsMidday) days -= 0.5;
  // A single day can only lose one half, never both.
  return Math.max(0.5, days);
}

/**
 * Which half of a given date someone is away for, or null when they are
 * away the whole day. Used by the schedule and the availability grid so a
 * half day removes them from the right half only.
 */
export function leaveHalfOnDate(
  req: { startDate: string; endDate: string; startsMidday?: boolean; endsMidday?: boolean },
  date: string
): "AM" | "PM" | null {
  if (date < req.startDate || date > req.endDate) return null;
  if (req.startsMidday && date === req.startDate) return "PM";
  if (req.endsMidday && date === req.endDate) return "AM";
  return null;
}

/** True when the person is away the entire day — the case that blocks scheduling. */
export function isFullDayLeave(
  req: { startDate: string; endDate: string; startsMidday?: boolean; endsMidday?: boolean },
  date: string
): boolean {
  if (date < req.startDate || date > req.endDate) return false;
  return leaveHalfOnDate(req, date) === null;
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

export async function deleteLeaveRequest(id: string): Promise<void> {
  const { error } = await supabase.from("leave_requests").delete().eq("id", id);
  if (error) console.error("deleteLeaveRequest error:", error);
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
