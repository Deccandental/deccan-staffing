export type LeaveReason = "sick" | "pto" | "leave" | "other";
export type LeaveStatus = "pending" | "approved" | "denied" | "cancelled";

export interface LeaveRequest {
  id: string;
  employeeId: number;
  employeeName: string;
  employeeEmail: string;
  startDate: string;
  endDate: string;
  isPartialDay: boolean;
  partialHours?: string;
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
