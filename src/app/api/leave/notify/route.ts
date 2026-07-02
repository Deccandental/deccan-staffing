import { NextRequest, NextResponse } from "next/server";

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

    const reasonLabels: Record<string, string> = { sick: "Sick Leave", pto: "PTO / Vacation", leave: "Personal Leave", other: "Other" };

    if (type === "submitted") {
      // Notify managers
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Deccan Dental <noreply@mydeccandental.com>",
          to: ["dr.nanjapa@mydeccandental.com", "ketki@mydeccandental.com"],
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

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Email error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
