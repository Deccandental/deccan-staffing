import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getPayPeriods, getLookaheadWindow } from "@/lib/payPeriods";

const REASON_LABELS: Record<string, string> = {
  sick: "Sick Leave", pto: "PTO / Vacation", leave: "Personal Leave", other: "Other",
};
const RECIPIENTS = ["dr.nanjapa@mydeccandental.com", "ketki@mydeccandental.com", "dr.coulter@mydeccandental.com"];

interface LeaveRow {
  employee_name: string;
  start_date: string;
  end_date: string;
  reason: string;
  total_days: number;
}

function dateRangeLabel(start: string, end: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  if (start === end) return s.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return `${s.toLocaleDateString("en-US", { month: "long", day: "numeric" })} – ${e.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`;
}

// Overlap match: the request starts on/before the window ends, and ends
// on/after the window starts — so multi-day requests spanning a boundary
// still show up in every period they touch.
async function loadApprovedOverlapping(start: string, end: string): Promise<LeaveRow[]> {
  const { data, error } = await supabase
    .from("leave_requests")
    .select("employee_name, start_date, end_date, reason, total_days")
    .eq("status", "approved")
    .lte("start_date", end)
    .gte("end_date", start)
    .order("start_date");
  if (error) { console.error("payroll-summary load error:", error); return []; }
  return data ?? [];
}

function renderSection(title: string, subtitle: string, rows: LeaveRow[]): string {
  const body = rows.length === 0
    ? `<p style="color:#888;font-style:italic;margin:8px 0 0">No approved leave requests.</p>`
    : `<table style="width:100%;border-collapse:collapse;margin:8px 0 0">
        ${rows.map((r) => `
          <tr>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;font-weight:bold">${r.employee_name}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee">${dateRangeLabel(r.start_date, r.end_date)}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#888">${REASON_LABELS[r.reason] ?? r.reason}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#888">${r.total_days} day${r.total_days !== 1 ? "s" : ""}</td>
          </tr>`).join("")}
      </table>`;
  return `
    <div style="margin-bottom:24px">
      <h2 style="font-size:15px;margin:0 0 2px;color:#333">${title}</h2>
      <p style="font-size:12px;color:#aaa;margin:0">${subtitle}</p>
      ${body}
    </div>`;
}

async function buildAndSend(): Promise<boolean> {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.log("No RESEND_API_KEY set — payroll summary skipped");
    return false;
  }

  const periods = getPayPeriods(new Date());
  const lookahead = getLookaheadWindow(periods.next.end);

  const [lastRows, nextRows, lookaheadRows] = await Promise.all([
    loadApprovedOverlapping(periods.last.start, periods.last.end),
    loadApprovedOverlapping(periods.next.start, periods.next.end),
    loadApprovedOverlapping(lookahead.start, lookahead.end),
  ]);

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#5a5a5a">
      <div style="background:#e8622a;padding:24px;border-radius:12px 12px 0 0">
        <h1 style="color:white;margin:0;font-size:20px">Payroll Leave Summary</h1>
      </div>
      <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px">
        ${renderSection(`Last Pay Period — ${periods.last.label}`, "Approved leave during the period just closed", lastRows)}
        ${renderSection(`Next Pay Period — ${periods.next.label}`, "Approved leave for the upcoming pay period", nextRows)}
        ${renderSection(lookahead.label, `${dateRangeLabel(lookahead.start, lookahead.end)} — for planning ahead`, lookaheadRows)}
        <p style="color:#888;font-size:12px;margin-top:8px">Deccan Dental Sleep Center</p>
      </div>
    </div>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Deccan Dental <noreply@mydeccandental.com>",
        to: RECIPIENTS,
        subject: `Payroll Leave Summary — ${periods.last.label} & ${periods.next.label}`,
        html,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("payroll-summary send error:", err);
    return false;
  }
}

// Cron-triggered — runs automatically on the 1st and 16th of each month (see vercel.json).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else {
    console.warn("CRON_SECRET is not set — /api/leave/payroll-summary is unauthenticated");
  }
  const sent = await buildAndSend();
  return NextResponse.json({ ok: true, sent });
}

// Manual trigger from the Manage Leave page. No separate secret required —
// reaching that page already requires the leaveManage passcode.
export async function POST() {
  const sent = await buildAndSend();
  return NextResponse.json({ ok: true, sent });
}
