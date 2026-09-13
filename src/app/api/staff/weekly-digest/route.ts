import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendStaffWeeklyDigest } from "@/lib/staffDigestEmail";

function daysUntil(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86400000);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else {
    console.warn("CRON_SECRET is not set — /api/staff/weekly-digest is unauthenticated");
  }

  const [{ data: staffRows }, { data: certRows }, { data: docs }, { data: eventRows }] = await Promise.all([
    supabase.from("staff").select("id, name, email, archived, exempt_from_policy_signing").eq("archived", false),
    supabase.from("certifications").select("*").not("expiration_date", "is", null),
    supabase.from("policy_documents").select("*"),
    supabase.from("events").select("*"),
  ]);

  const docRequirements: { docTitle: string; requirementId: string; cycleLabel: string; signedIds: Set<number> }[] = [];
  for (const doc of docs ?? []) {
    const { data: req } = await supabase.from("policy_requirements").select("*")
      .eq("document_id", doc.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!req) continue;
    const { data: sigs } = await supabase.from("policy_signatures").select("employee_id").eq("requirement_id", req.id);
    docRequirements.push({ docTitle: doc.title, requirementId: req.id, cycleLabel: req.cycle_label, signedIds: new Set((sigs ?? []).map((s) => s.employee_id)) });
  }

  const results: { employeeId: number; itemCount: number; sent: boolean }[] = [];

  for (const emp of staffRows ?? []) {
    if (!emp.email) continue;
    const items: string[] = [];

    for (const cert of (certRows ?? []).filter((c) => c.employee_id === emp.id)) {
      const remaining = daysUntil(cert.expiration_date);
      if (remaining < 0) items.push(`<strong>Certification expired:</strong> ${cert.title} (expired ${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? "" : "s"} ago)`);
      else if (remaining <= 60) items.push(`<strong>Certification expiring:</strong> ${cert.title} — ${remaining} day${remaining === 1 ? "" : "s"} left`);
    }

    if (!emp.exempt_from_policy_signing) {
      for (const dr of docRequirements) {
        if (!dr.signedIds.has(emp.id)) items.push(`<strong>Signature needed:</strong> ${dr.docTitle} (${dr.cycleLabel})`);
      }
    }

    for (const ev of eventRows ?? []) {
      const invited = ev.invite_all || (ev.invited_staff_ids ?? []).includes(emp.id);
      if (!invited) continue;
      const remaining = daysUntil(ev.date);
      if (remaining >= 0 && remaining <= 21) {
        items.push(`<strong>${ev.mandatory ? "Mandatory event" : "Event"}:</strong> ${ev.title} on ${new Date(ev.date + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" })}`);
      }
    }

    const sent = await sendStaffWeeklyDigest({ employeeName: emp.name, employeeEmail: emp.email, items });
    results.push({ employeeId: emp.id, itemCount: items.length, sent });
  }

  return NextResponse.json({ ok: true, results });
}
