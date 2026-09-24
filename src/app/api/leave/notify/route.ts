import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  try {
    const { request, type } = await req.json();

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      console.log("No RESEND_API_KEY set — email skipped");
      return NextResponse.json({ ok: true, skipped: true });
    }

    const dateRange = request.startDate === request.endDate
      ? new Date(request.startDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
      : `${new Date(request.startDate + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" })} – ${new Date(request.endDate + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;

    const reasonLabels: Record<string, string> = { sick: "Paid Sick Leave", pto: "PTO", leave: "Unpaid Personal Leave", other: "Other" };

    if (type === "submitted") {
      // Notify managers
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Deccan Dental <noreply@mydeccandental.com>",
          to: ["dr.nanjapa@mydeccandental.com"],
          subject: `New Leave Request — ${request.employeeName}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#5a5a5a">
              <div style="background:#e8622a;padding:24px;border-radius:12px 12px 0 0">
                <h1 style="color:white;margin:0;font-size:20px">New Leave Request</h1>
              </div>
              <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px">
                <p><strong>${request.employeeName}</strong> has submitted a leave request:</p>
                <table style="width:100%;border-collapse:collapse;margin:16px 0">
                  <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Dates</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold">${dateRange}</td></tr>
                  <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Duration</td><td style="padding:8px;border-bottom:1px solid #eee">${request.totalDays} working day${request.totalDays !== 1 ? "s" : ""}${request.isPartialDay ? ` (${request.partialHours || "partial day"})` : ""}</td></tr>
                  <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Reason</td><td style="padding:8px;border-bottom:1px solid #eee">${reasonLabels[request.reason]}</td></tr>
                  ${request.notes ? `<tr><td style="padding:8px;color:#888">Notes</td><td style="padding:8px;font-style:italic">"${request.notes}"</td></tr>` : ""}
                </table>
                <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/leave/manage" style="display:inline-block;background:#e8622a;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:8px">Review Request →</a>
              </div>
            </div>
          `,
        }),
      });
    } else {
      // Notify employee of decision
      const approved = type === "approved";
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Deccan Dental <noreply@mydeccandental.com>",
          to: [request.employeeEmail],
          subject: `Leave Request ${approved ? "Approved" : "Denied"} — ${dateRange}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#5a5a5a">
              <div style="background:${approved ? "#16a34a" : "#dc2626"};padding:24px;border-radius:12px 12px 0 0">
                <h1 style="color:white;margin:0;font-size:20px">Leave Request ${approved ? "✓ Approved" : "✕ Denied"}</h1>
              </div>
              <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px">
                <p>Hi ${request.employeeName},</p>
                <p>Your leave request has been <strong>${approved ? "approved" : "denied"}</strong>.</p>
                <table style="width:100%;border-collapse:collapse;margin:16px 0">
                  <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Dates</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold">${dateRange}</td></tr>
                  <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Duration</td><td style="padding:8px;border-bottom:1px solid #eee">${request.totalDays} day${request.totalDays !== 1 ? "s" : ""}</td></tr>
                  <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Reason</td><td style="padding:8px;border-bottom:1px solid #eee">${reasonLabels[request.reason]}</td></tr>
                  ${request.reviewNote ? `<tr><td style="padding:8px;color:#888">Manager note</td><td style="padding:8px;font-style:italic">"${request.reviewNote}"</td></tr>` : ""}
                </table>
                ${approved ? "<p style='color:#16a34a'>✓ Your absence has been recorded on the schedule.</p>" : ""}
                <p style="color:#888;font-size:12px;margin-top:24px">Deccan Dental Sleep Center</p>
              </div>
            </div>
          `,
        }),
      });
    }

    // Whoever builds the rota needs to know about approved leave promptly —
    // the twice-monthly payroll summary is too slow to schedule around.
    // Includes the last two weeks of approvals so a missed email doesn't
    // mean a missed absence.
    if (type === "approved") {
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data: recent } = await supabaseAdmin
        .from("leave_requests")
        .select("employee_name, start_date, end_date, reason, total_days, reviewed_at")
        .eq("status", "approved")
        .gte("reviewed_at", twoWeeksAgo)
        .order("start_date");

      const reasonLabel: Record<string, string> = { sick: "Paid Sick Leave", pto: "PTO", leave: "Unpaid Personal Leave", other: "Other" };
      const fmt = (s: string, e: string) => s === e
        ? new Date(s + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
        : `${new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(e + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

      const rows = (recent ?? []).map((r) => `
        <div style="padding:7px 0;border-bottom:1px solid #eee;font-size:14px">
          <span style="font-weight:bold;color:#333">${fmt(r.start_date, r.end_date)}</span>
          <span style="color:#333"> — ${r.employee_name}</span>
          <span style="color:#888"> · ${reasonLabel[r.reason] ?? r.reason} · ${r.total_days} day${r.total_days !== 1 ? "s" : ""}</span>
        </div>`).join("");

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Deccan Dental <noreply@mydeccandental.com>",
          to: ["ketki@mydeccandental.com", "dr.coulter@mydeccandental.com", "dr.nanjapa@mydeccandental.com"],
          subject: `Leave Approved — ${request.employeeName}, ${dateRange}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#5a5a5a">
              <div style="background:#e8622a;padding:24px;border-radius:12px 12px 0 0">
                <h1 style="color:white;margin:0;font-size:20px">Leave Approved</h1>
              </div>
              <div style="padding:24px;background:#fff;border:1px solid #eee;border-top:0;border-radius:0 0 12px 12px">
                <p style="margin:0 0 4px"><strong>${request.employeeName}</strong> has been approved for leave on <strong>${dateRange}</strong>.</p>
                <p style="margin:0 0 20px;color:#888;font-size:13px">Please check the schedule for these dates — if they were already assigned manually, their name stays on the rota until someone updates it.</p>
                <h2 style="font-size:15px;margin:0 0 2px;color:#333">All leave approved in the last two weeks</h2>
                <p style="font-size:12px;color:#aaa;margin:0">Listed by start date.</p>
                ${rows || '<p style="color:#888;font-style:italic;margin:8px 0 0">Nothing else approved recently.</p>'}
              </div>
            </div>
          `,
        }),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Email error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
