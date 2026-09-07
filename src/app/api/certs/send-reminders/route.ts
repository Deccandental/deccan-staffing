import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendCertEmail, CertEmailType } from "@/lib/certEmail";
import { Certification } from "@/lib/certsStore";

function fromRow(row: any): Certification {
  return {
    id: row.id,
    ownerType: row.owner_type,
    employeeId: row.employee_id ?? null,
    title: row.title,
    expirationDate: row.expiration_date ?? null,
    fileUrl: row.file_url,
    fileName: row.file_name ?? "",
    remindersSent: row.reminders_sent ?? {},
    createdAt: row.created_at,
  };
}

// Whole-day difference computed from the date-only strings (UTC midnight for
// both sides) so this is stable regardless of the server's local timezone.
function daysUntil(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86400000);
}

const THRESHOLDS: { days: number; key: string; type: CertEmailType }[] = [
  { days: 60, key: "day60", type: "reminder-60day" },
  { days: 30, key: "day30", type: "reminder-30day" },
  { days: 7, key: "day7", type: "reminder-7day" },
];

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else {
    console.warn("CRON_SECRET is not set — /api/certs/send-reminders is unauthenticated");
  }

  const todayStr = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase.from("certifications").select("*").gte("expiration_date", todayStr);
  if (error) {
    console.error("certs/send-reminders load error:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const certs = (data ?? []).map(fromRow);
  const results: { certId: string; type: string; sent: boolean }[] = [];

  for (const cert of certs) {
    if (!cert.expirationDate) continue; // shouldn't happen given the query filter, but keeps this type-safe
    const remaining = daysUntil(cert.expirationDate);
    for (const t of THRESHOLDS) {
      if (remaining !== t.days) continue;
      if (cert.remindersSent[t.key]) continue;

      const sent = await sendCertEmail(cert, t.type);
      results.push({ certId: cert.id, type: t.type, sent });
      if (sent) {
        const updatedFlags = { ...cert.remindersSent, [t.key]: true };
        await supabase.from("certifications").update({ reminders_sent: updatedFlags }).eq("id", cert.id);
      }
    }
  }

  return NextResponse.json({ ok: true, checked: certs.length, sent: results });
}
