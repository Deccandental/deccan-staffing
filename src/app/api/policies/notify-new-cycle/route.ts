import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendPolicySignReminder } from "@/lib/policyEmail";

export async function POST(req: NextRequest) {
  const { requirementId } = await req.json();
  if (!requirementId) return NextResponse.json({ ok: false, error: "missing requirementId" }, { status: 400 });

  const { data: reqRow, error: reqErr } = await supabase.from("policy_requirements").select("*").eq("id", requirementId).maybeSingle();
  if (reqErr || !reqRow) return NextResponse.json({ ok: false, error: "requirement not found" }, { status: 404 });

  const { data: doc } = await supabase.from("policy_documents").select("*").eq("id", reqRow.document_id).maybeSingle();
  const { data: staffRows, error: staffErr } = await supabase.from("staff").select("id, name, email").eq("archived", false);
  if (staffErr) return NextResponse.json({ ok: false }, { status: 500 });

  const { data: sigs } = await supabase.from("policy_signatures").select("employee_id").eq("requirement_id", requirementId);
  const signedIds = new Set((sigs ?? []).map((s) => s.employee_id));
  const pending = (staffRows ?? []).filter((e) => !signedIds.has(e.id));

  const results: { employeeId: number; sent: boolean }[] = [];
  for (const emp of pending) {
    const sent = await sendPolicySignReminder({
      employeeName: emp.name, employeeEmail: emp.email ?? undefined,
      documentTitle: doc?.title ?? "Policy Document", cycleLabel: reqRow.cycle_label, isNewCycle: true,
    });
    results.push({ employeeId: emp.id, sent });
    if (sent) {
      await supabase.from("policy_reminders_sent").upsert({
        requirement_id: requirementId, employee_id: emp.id, sent_at: new Date().toISOString(),
      }, { onConflict: "requirement_id,employee_id" });
    }
  }

  return NextResponse.json({ ok: true, sent: results });
}
