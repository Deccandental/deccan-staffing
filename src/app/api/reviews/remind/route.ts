import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { reviewEmailHtml, sendEmails } from "@/lib/reviewAuth";

// Runs once a day. From a document's due date on, anyone who hasn't reviewed it gets a reminder email,
// repeated every 3 days until they do. One email per person, listing everything they still owe.
export const runtime = "nodejs";
const EVERY_DAYS = 3;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const today = new Date().toISOString().slice(0, 10);
  const { data: docs } = await supabaseAdmin.from("review_docs").select("id, title, note, due_date").eq("closed", false).not("due_date", "is", null).lte("due_date", today);
  if (!docs || docs.length === 0) return NextResponse.json({ ok: true, reminded: 0 });
  const docById = new Map(docs.map((d: any) => [d.id, d]));

  const cutoff = new Date(Date.now() - EVERY_DAYS * 86400000).toISOString();
  const { data: pend } = await supabaseAdmin.from("review_assignments").select("id, doc_id, employee_id, employee_name, reminder_sent_at")
    .in("doc_id", docs.map((d: any) => d.id)).is("reviewed_at", null);
  const due = (pend ?? []).filter((a: any) => !a.reminder_sent_at || a.reminder_sent_at < cutoff);
  if (due.length === 0) return NextResponse.json({ ok: true, reminded: 0 });

  const byPerson = new Map<number, any[]>();
  for (const a of due) byPerson.set(a.employee_id, [...(byPerson.get(a.employee_id) ?? []), a]);
  const { data: staff } = await supabaseAdmin.from("staff").select("id, name, email, archived").in("id", [...byPerson.keys()]);
  const people = (staff ?? []).filter((s: any) => !s.archived && s.email);

  const ok = await sendEmails(people.map((p: any) => ({
    to: p.email,
    subject: byPerson.get(p.id)!.length === 1 ? `Reminder: please review ${docById.get(byPerson.get(p.id)![0].doc_id).title}` : "Reminder: documents waiting for your review",
    html: reviewEmailHtml({ heading: "Reminder: documents to review", name: p.name, intro: "These are past their review date and still need your review.",
      items: byPerson.get(p.id)!.map((a: any) => { const d: any = docById.get(a.doc_id); return { title: d.title, due: d.due_date, note: d.note }; }) }),
  })));
  if (ok) await supabaseAdmin.from("review_assignments").update({ reminder_sent_at: new Date().toISOString() }).in("id", due.filter((a: any) => people.some((p: any) => p.id === a.employee_id)).map((a: any) => a.id));
  return NextResponse.json({ ok, reminded: people.length });
}
