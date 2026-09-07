import { supabase } from "./supabase";
import { Certification } from "./certsStore";

export type CertEmailType = "reminder-7day" | "reminder-30day" | "reminder-60day" | "manual";

const LABELS: Record<CertEmailType, string> = {
  "reminder-60day": "Expiring in 60 Days",
  "reminder-30day": "Expiring in 30 Days",
  "reminder-7day": "Expiring in 7 Days",
  manual: "Certification Reminder",
};

const ADMIN_RECIPIENTS = ["dr.nanjapa@mydeccandental.com", "ketki@mydeccandental.com", "dr.coulter@mydeccandental.com"];

export async function resolveRecipients(cert: Certification): Promise<string[]> {
  const recipients = new Set<string>(ADMIN_RECIPIENTS);
  if (cert.ownerType === "personnel" && cert.employeeId != null) {
    const { data } = await supabase.from("staff").select("email").eq("id", cert.employeeId).single();
    if (data?.email) recipients.add(data.email);
  }
  return Array.from(recipients);
}

export async function sendCertEmail(cert: Certification, type: CertEmailType): Promise<boolean> {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.log("No RESEND_API_KEY set — certification email skipped");
    return false;
  }

  const recipients = await resolveRecipients(cert);
  if (recipients.length === 0) return false;

  const expLabel = new Date(cert.expirationDate + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
  const label = LABELS[type];

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Deccan Dental <noreply@mydeccandental.com>",
        to: recipients,
        subject: `${label} — ${cert.title}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#5a5a5a">
            <div style="background:#e8622a;padding:24px;border-radius:12px 12px 0 0">
              <h1 style="color:white;margin:0;font-size:20px">${label}</h1>
            </div>
            <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px">
              <p style="font-size:18px;font-weight:bold;margin:0 0 4px">${cert.title}</p>
              <p style="color:#888;font-size:13px;margin:0 0 12px">${cert.ownerType === "business" ? "Business license" : "Personnel certification"}</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0">
                <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Expires</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold">${expLabel}</td></tr>
                ${cert.issuingAuthority ? `<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Issuing Authority</td><td style="padding:8px;border-bottom:1px solid #eee">${cert.issuingAuthority}</td></tr>` : ""}
              </table>
              <a href="${cert.fileUrl}" style="display:inline-block;background:#e8622a;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:8px">View Document →</a>
              <p style="color:#888;font-size:12px;margin-top:24px">Deccan Dental Sleep Center</p>
            </div>
          </div>
        `,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("sendCertEmail error:", err);
    return false;
  }
}
