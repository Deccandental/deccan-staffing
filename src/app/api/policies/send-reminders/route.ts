import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendPolicySignReminder } from "@/lib/policyEmail";

const REMINDER_THROTTLE_DAYS = 6;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else {
    console.warn("CRON_SECRET is not set — /api/policies/send-reminders is unauthenticated");
  }

  const { data: docs, error: docsErr } = await supabase.from("policy_documents").select("*");
  if (docsErr) { console.error("policies/send-reminders load docs error:", docsErr); return NextResponse.json({ ok: false }, { status: 500 }); }

  const { data: staffRows, error: staffErr } = await supabase.from("staff").select("id, name, email").eq("archived", false);
  if (staffErr) { console.error("policies/send-reminders load staff error:", staffErr); return NextResponse.json({ ok: false }, { status: 500 }); }

  const results: { document: string; employeeId: number; sent: boolean }[] = [];
  const now = Date.now();

  for (const doc of docs ?? []) {
    const { data: req } = await supabase.from("policy_requirements").select("*")
      .eq("document_id", doc.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!req) continue;

    const { data: sigs } = await supabase.from("policy_signatures").select("employee_id").eq("requirement_id", req.id);
    const signedIds = new Set((sigs ?? []).map((s) => s.employee_id));
    const pending = (staffRows ?? []).filter((e) => !signedIds.has(e.id));

    for (const emp of pending) {
      const { data: reminderRow } = await supabase.from("policy_reminders_sent").select("sent_at")
        .eq("requirement_id", req.id).eq("employee_id", emp.id).maybeSingle();
      if (reminderRow?.sent_at) {
        const daysSince = (now - new Date(reminderRow.sent_at).getTime()) / 86400000;
        if (daysSince < REMINDER_THROTTLE_DAYS) continue;
      }

      const sent = await sendPolicySignReminder({
        employeeName: emp.name, employeeEmail: emp.email ?? undefined,
        documentTitle: doc.title, cycleLabel: req.cycle_label, isNewCycle: false,
      });
      results.push({ document: doc.slug, employeeId: emp.id, sent });
      if (sent) {
        await supabase.from("policy_reminders_sent").upsert({
          requirement_id: req.id, employee_id: emp.id, sent_at: new Date().toISOString(),
        }, { onConflict: "requirement_id,employee_id" });
      }
    }
  }

  return NextResponse.json({ ok: true, sent: results });
}
