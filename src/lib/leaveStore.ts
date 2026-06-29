import { LeaveRequest, LeaveStatus } from "@/types/leave";

const LEAVE_KEY = "deccan-leave-v1";

export function loadLeaveRequests(): LeaveRequest[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(LEAVE_KEY) ?? "[]"); }
  catch { return []; }
}

export function saveLeaveRequests(requests: LeaveRequest[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LEAVE_KEY, JSON.stringify(requests));
}

export function addLeaveRequest(req: Omit<LeaveRequest, "id" | "submittedAt" | "status">): LeaveRequest {
  const requests = loadLeaveRequests();
  const newReq: LeaveRequest = {
    ...req,
    id: `leave-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    status: "pending",
    submittedAt: new Date().toISOString(),
  };
  saveLeaveRequests([...requests, newReq]);
  return newReq;
}

export function updateLeaveStatus(id: string, status: LeaveStatus, reviewNote?: string): LeaveRequest | null {
  const requests = loadLeaveRequests();
  const idx = requests.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  requests[idx] = { ...requests[idx], status, reviewNote, reviewedAt: new Date().toISOString() };
  saveLeaveRequests(requests);
  return requests[idx];
}

export function cancelLeaveRequest(id: string): boolean {
  const requests = loadLeaveRequests();
  const idx = requests.findIndex((r) => r.id === id);
  if (idx === -1 || requests[idx].status !== "pending") return false;
  requests[idx].status = "cancelled";
  saveLeaveRequests(requests);
  return true;
}

export function countBusinessDays(start: string, end: string): number {
  const CLOSED = new Set([0, 2, 6]);
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(startDate + "T00:00:00");
  const weeksNotice = (start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 7);
  if (totalDays > 14 && weeksNotice < 8) return `Requests over 14 days require 8 weeks notice. You have ${weeksNotice.toFixed(1)} weeks.`;
  if (totalDays > 7 && weeksNotice < 6) return `Requests over 7 days require 6 weeks notice. You have ${weeksNotice.toFixed(1)} weeks.`;
  if (totalDays > 3 && weeksNotice < 4) return `Requests over 3 days require 4 weeks notice. You have ${weeksNotice.toFixed(1)} weeks.`;
  return null;
}
