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
}
