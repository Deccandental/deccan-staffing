// Signed session tokens, so server routes can verify who is calling.
//
// The app's PIN login (see /api/auth/login) proves identity once. This
// module turns that into a short signed token the browser holds and sends
// back on later requests — letting privileged routes confirm both that the
// caller really did log in, and what permissions they have, without ever
// trusting values the browser could simply edit.
//
// Deliberately uses only Node's built-in crypto (HMAC-SHA256) rather than
// adding a JWT dependency — the payload is small and fully under our
// control, so a signed-and-base64'd blob is sufficient and keeps the
// dependency surface unchanged.
import crypto from "crypto";

const SECRET = process.env.SESSION_SECRET ?? "";

// How long a session stays valid before the user must re-enter their PIN.
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface SessionPayload {
  mode: "super" | "staff";
  employeeId?: number;
  employeeName?: string;
  canAdmin: boolean;
  canManageLeave: boolean;
  canManageEvents: boolean;
  canManageCerts: boolean;
  canManagePayroll: boolean;
  issuedAt: number;
}

function sign(data: string): string {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

export function createSessionToken(payload: Omit<SessionPayload, "issuedAt">): string {
  const full: SessionPayload = { ...payload, issuedAt: Date.now() };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${body}.${sign(body)}`;
}

// Returns the payload only if the signature is valid AND the token hasn't
// expired. Any tampering with the payload changes its signature, so an
// edited token (e.g. flipping canManagePayroll to true) is rejected here.
export function verifySessionToken(token: string | null | undefined): SessionPayload | null {
  if (!SECRET) {
    console.error("SESSION_SECRET is not set — session tokens cannot be verified.");
    return null;
  }
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  // Constant-time comparison, so the time this check takes can't be used to
  // guess a valid signature byte by byte.
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
  if (!payload.issuedAt || Date.now() - payload.issuedAt > MAX_AGE_MS) return null;
  return payload;
}
