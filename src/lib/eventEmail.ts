import { supabase } from "./supabase";
import { StaffEvent } from "./eventsStore";

export type EventEmailType = "announcement" | "reminder-1day" | "reminder-1week" | "reminder-3weeks";

const LABELS: Record<EventEmailType, string> = {
  announcement: "New Event",
  "reminder-1day": "Reminder: Tomorrow",
  "reminder-1week": "Reminder: In 1 Week",
  "reminder-3weeks": "Reminder: In 3 Weeks",
};

export async function resolveRecipients(event: StaffEvent): Promise<{ name: string; email: string }[]> {
  const { data, error } = await supabase.from("staff").select("id, name, email");
  if (error || !data) return [];
  const withEmail = (data as { id: number; name: string; email: string | null }[]).filter((s) => !!s.email);
  if (event.inviteAll) return withEmail.map((s) => ({ name: s.name, email: s.email as string }));
  return withEmail
    .filter((s) => event.invitedStaffIds.includes(s.id))
    .map((s) => ({ name: s.name, email: s.email as string }));
}

export async function sendEventEmail(event: StaffEvent, type: EventEmailType): Promise<boolean> {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.log("No RESEND_API_KEY set — event email skipped");
    return false;
  }

  const recipients = await resolveRecipients(event);
  if (recipients.length === 0) return false;

  const dateLabel = new Date(event.date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
  const label = LABELS[type];

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Deccan Dental <noreply@mydeccandental.com>",
        to: recipients.map((r) => r.email),
        subject: `${label} — ${event.title}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#5a5a5a">
            <div style="background:${event.mandatory ? "#dc2626" : "#e8622a"};padding:24px;border-radius:12px 12px 0 0">
              <h1 style="color:white;margin:0;font-size:20px">${label}</h1>
            </div>
            <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px">
              <p style="font-size:18px;font-weight:bold;margin:0 0 4px">${event.title}</p>
              ${event.mandatory ? `<p style="color:#dc2626;font-weight:bold;margin:0 0 12px">⚠ Mandatory attendance</p>` : ""}
              <table style="width:100%;border-collapse:collapse;margin:16px 0">
                <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Date</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold">${dateLabel}</td></tr>
                ${event.time ? `<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Time</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold">${event.time}${event.endTime ? ` – ${event.endTime}` : ""}</td></tr>` : ""}
                ${event.description ? `<tr><td style="padding:8px;color:#888">Details</td><td style="padding:8px">${event.description}</td></tr>` : ""}
              </table>
              <p style="color:#888;font-size:12px;margin-top:24px">Deccan Dental Sleep Center</p>
            </div>
          </div>
        `,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("sendEventEmail error:", err);
    return false;
  }
}
