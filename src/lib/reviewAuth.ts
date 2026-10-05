// Shared helpers for the "documents to review" feature. Server-side only.
import { NextRequest } from "next/server";
import { verifySessionToken, SessionPayload } from "@/lib/session";

export const REVIEW_BUCKET = "statements";   // the same private bucket, under the reviews/ folder
export const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? "";

/** Admins only: the manager passcode, or someone with Admin access. */
export function adminSession(req: NextRequest): SessionPayload | null {
  const s = verifySessionToken(req.headers.get("x-session-token"));
  if (!s) return null;
  return s.mode === "super" || s.canAdmin ? s : null;
}

/** A staff member logged in with their own PIN. They can only ever see documents assigned to them. */
export function staffSession(req: NextRequest): (SessionPayload & { employeeId: number }) | null {
  const s = verifySessionToken(req.headers.get("x-session-token"));
  if (!s || s.mode !== "staff" || s.employeeId == null) return null;
  return s as SessionPayload & { employeeId: number };
}

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtDate = (d: string | null | undefined) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "");

export interface EmailItem { title: string; due: string | null; note?: string }

export function reviewEmailHtml(opts: { heading: string; name: string; intro: string; items: EmailItem[] }): string {
  const rows = opts.items.map((i) => `
    <div style="background:#fff;border:1px solid #eee;border-radius:10px;padding:12px 14px;margin:10px 0">
      <p style="margin:0;font-weight:bold;font-size:15px">${esc(i.title)}</p>
      ${i.due ? `<p style="margin:4px 0 0;color:#888;font-size:13px">Please review by ${esc(fmtDate(i.due))}</p>` : ""}
      ${i.note ? `<p style="margin:6px 0 0;font-size:13px">${esc(i.note)}</p>` : ""}
    </div>`).join("");
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#5a5a5a">
    <div style="background:#e8622a;padding:20px;border-radius:12px 12px 0 0"><h1 style="color:#fff;margin:0;font-size:19px">${esc(opts.heading)}</h1></div>
    <div style="background:#f9f9f9;padding:22px;border-radius:0 0 12px 12px">
      <p>Hi ${esc(opts.name.split(" ")[0] || "there")},</p>
      <p>${esc(opts.intro)}</p>
      ${rows}
      <p style="margin:22px 0"><a href="${APP_URL()}/review" style="background:#e8622a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Open my documents</a></p>
      <p style="font-size:13px">Log in with your PIN, open the document, then tick the box and type your initials to confirm you've reviewed it.</p>
      <p style="color:#888;font-size:12px;margin-top:20px">Deccan Dental Sleep Center</p>
    </div></div>`;
}

/** One separate message per person, sent through the existing email service. */
export async function sendEmails(messages: { to: string; subject: string; html: string }[]): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.log("No RESEND_API_KEY set -- review emails skipped"); return false; }
  if (messages.length === 0) return true;
  const from = "Deccan Dental <noreply@mydeccandental.com>";
  let ok = true;
  try {
    for (let i = 0; i < messages.length; i += 100) {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(messages.slice(i, i + 100).map((m) => ({ from, to: [m.to], subject: m.subject, html: m.html }))),
      });
      if (!res.ok) ok = false;
    }
  } catch (err) { console.error("review email error:", err); return false; }
  return ok;
}
