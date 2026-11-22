import { LeaveRequest, LeaveStatus, LeaveReason } from "@/types/leave";
import { secureData as supabase } from "./secureData";

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
export function countLeaveDays(start: string, end: string, startsMidday: boolean, endsMidday: boolean, ctx?: LeaveDayContext): number {
  if (!start || !end || end < start) return 0;
  let days = 0;
  eachDate(start, end, (date) => {
    let v = workdayValue(date, ctx);
    // Only half of a day is taken when leave starts or ends at midday — and
    // only if that day was a working day to begin with (a half day on a
    // weekend or holiday shouldn't reduce the total).
    if (v > 0 && ((startsMidday && date === start) || (endsMidday && date === end))) v = Math.min(v, 0.5);
    days += v;
  });
  return days;
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

// Returns true only if the request was actually changed. Approving or
// denying only applies to a request that is still pending, so a double click
// (or two managers at once) can't approve it twice and deduct PTO twice.
export async function updateLeaveStatus(id: string, status: LeaveStatus, reviewNote?: string): Promise<boolean> {
  let query = supabase.from("leave_requests").update({
    status, review_note: reviewNote ?? null, reviewed_at: new Date().toISOString(),
  }).eq("id", id);
  if (status === "approved" || status === "denied") query = query.eq("status", "pending");
  const { data, error } = await query;
  if (error) { console.error("updateLeaveStatus error:", error); return false; }
  return Array.isArray(data) && data.length > 0;
}

export async function cancelLeaveRequest(id: string): Promise<void> {
  const { error } = await supabase.from("leave_requests").update({ status: "cancelled" }).eq("id", id).eq("status", "pending");
  if (error) console.error("cancelLeaveRequest error:", error);
}

export async function deleteLeaveRequest(id: string): Promise<void> {
  const { error } = await supabase.from("leave_requests").delete().eq("id", id);
  if (error) console.error("deleteLeaveRequest error:", error);
}

// What the office calendar looks like, so leave only costs days that would
// actually have been worked. Without it, every weekday counts (the old rule).
export interface LeaveDayContext {
  holidays?: { date: string }[];
  openTuesdays?: { date: string; halfDay: "AM" | "PM" | null }[];
  // The person's own working pattern; days they don't normally work are free.
  schedule?: Partial<Record<"monday" | "tuesday" | "wednesday" | "thursday" | "friday", boolean>>;
}

const WEEKDAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

function pad2(n: number) { return String(n).padStart(2, "0"); }

/** How much of a working day this date is for the person: 1, 0.5 (half-day open Tuesday) or 0. */
export function workdayValue(date: string, ctx?: LeaveDayContext): number {
  const d = new Date(date + "T00:00:00");
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return 0;
  if (!ctx) return 1;
  if (ctx.holidays?.some((h) => h.date === date)) return 0;
  const key = WEEKDAY_KEYS[dow] as keyof NonNullable<LeaveDayContext["schedule"]>;
  if (ctx.schedule && !ctx.schedule[key]) return 0;
  if (dow === 2) {
    const open = ctx.openTuesdays?.find((t) => t.date === date);
    if (!open) return 0; // the office is closed on Tuesdays unless opened
    return open.halfDay ? 0.5 : 1;
  }
  return 1;
}

function eachDate(start: string, end: string, fn: (date: string) => void) {
  const cur = new Date(start + "T00:00:00");
  const endDate = new Date(end + "T00:00:00");
  while (cur <= endDate) {
    fn(`${cur.getFullYear()}-${pad2(cur.getMonth() + 1)}-${pad2(cur.getDate())}`);
    cur.setDate(cur.getDate() + 1);
  }
}

export function countBusinessDays(start: string, end: string, ctx?: LeaveDayContext): number {
  let count = 0;
  eachDate(start, end, (date) => { count += workdayValue(date, ctx); });
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
