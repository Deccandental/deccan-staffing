// Server-only helpers for checking who is calling an API route.
import { NextRequest } from "next/server";
import { verifySessionToken, SessionPayload } from "./session";
import { makeCtx, Perm } from "./dataPolicy";

export function sessionFrom(req: NextRequest): SessionPayload | null {
  const s = verifySessionToken(req.headers.get("x-session-token"));
  return s && s.mode !== "cpa" ? s : null;
}

export function hasPerm(session: SessionPayload | null, perm: Perm): boolean {
  return makeCtx(session).has(perm);
}

// Scheduled jobs (Vercel cron) send "Authorization: Bearer <CRON_SECRET>".
// If the secret isn't configured, refuse rather than run for anyone.
export function isCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET is not set — refusing scheduled-job request.");
    return false;
  }
  return req.headers.get("authorization") === `Bearer ${secret}`;
}
