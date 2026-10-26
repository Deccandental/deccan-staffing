export type LeaveReason = "sick" | "pto" | "leave" | "other";
export type LeaveStatus = "pending" | "approved" | "denied" | "cancelled";

export interface LeaveRequest {
  id: string;
  employeeId: number;
  employeeName: string;
  employeeEmail: string;
  startDate: string;
  endDate: string;
  // Half days are only ever the first or last day of a request. Someone
  // leaving at midday is away that afternoon; someone back at midday is away
  // that morning. Days in between are always full, which keeps an extended
  // break down to two choices instead of one per day.
  startsMidday: boolean;  // away the AFTERNOON of startDate
  endsMidday: boolean;    // away the MORNING of endDate
  isPartialDay: boolean;  // derived: either half is set
  partialHours?: string;  // legacy free text from before halves were structured
  reason: LeaveReason;
  notes: string;
  status: LeaveStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewNote?: string;
  totalDays: number;
  // Actual hours to be paid — only meaningful for "pto" and "sick" (the paid
  // leave reasons). Defaults to totalDays*8 for full days or totalDays*4 for
  // partial days, but staff can edit it to the exact hours they want paid.
  paidHours?: number;
}
