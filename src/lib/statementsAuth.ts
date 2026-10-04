// Who may use the statements area, and what they may do. Server-side only.
//
//   finance: the manager passcode, or someone with Payroll permission. Can upload, mark and remove.
//   cpa:     the CPA's own passcode. Can list and download, nothing else, and the session lasts 4 hours.
//
// Anyone else (including every other staff member) gets nothing.
import { NextRequest } from "next/server";
import { verifySessionToken, SessionPayload } from "@/lib/session";

const CPA_MAX_AGE_MS = 4 * 60 * 60 * 1000;

export type StatementsRole = "finance" | "cpa";

export function statementsAccess(req: NextRequest): { session: SessionPayload; role: StatementsRole } | null {
  const session = verifySessionToken(req.headers.get("x-session-token"));
  if (!session) return null;
  if (session.mode === "cpa") {
    if (Date.now() - session.issuedAt > CPA_MAX_AGE_MS) return null;
    return { session, role: "cpa" };
  }
  if (session.mode === "super" || session.canManagePayroll) return { session, role: "finance" };
  return null;
}

export function whoIs(s: SessionPayload): string {
  if (s.mode === "cpa") return "CPA";
  if (s.mode === "super") return "Manager passcode";
  return s.employeeName ?? `Employee ${s.employeeId ?? "?"}`;
}

export const BUCKET = "statements";
export const MAX_BYTES = 15 * 1024 * 1024;
export const KINDS = new Set(["bank", "card", "loan", "vendor", "other"]);
export const CATEGORIES = new Set(["Lab", "Supplier", "Insurance", "Other"]);
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "account";
}
