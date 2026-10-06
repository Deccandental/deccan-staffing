import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { staffSession, REVIEW_BUCKET } from "@/lib/reviewAuth";

// A staff member's own documents to review. They only ever see documents assigned to them.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = staffSession(req);
  if (!session) return NextResponse.json({ error: "Log in with your own PIN to see your documents." }, { status: 403 });
  const b = await req.json().catch(() => ({}));

  try {
    if (b.action === "list") {
      const { data: assigns, error } = await supabaseAdmin.from("review_assignments").select("id, doc_id, opened_at, reviewed_at, initials, assigned_at").eq("employee_id", session.employeeId);
      if (error) return NextResponse.json({ error: "Documents to review aren't set up yet." }, { status: 500 });
      const ids = (assigns ?? []).map((a: any) => a.doc_id);
      const { data: docs } = ids.length ? await supabaseAdmin.from("review_docs").select("id, title, note, due_date, file_name, created_at, closed").in("id", ids) : { data: [] as any[] };
      const byId = new Map((docs ?? []).map((d: any) => [d.id, d]));
      const items = (assigns ?? []).map((a: any) => ({ ...a, doc: byId.get(a.doc_id) })).filter((x: any) => x.doc && !x.doc.closed);
      return NextResponse.json({ items });
    }

    if (b.action === "count") {
      const { data: waiting } = await supabaseAdmin.from("review_assignments").select("doc_id").eq("employee_id", session.employeeId).is("reviewed_at", null);
      const ids = (waiting ?? []).map((a: any) => a.doc_id);
      if (ids.length === 0) return NextResponse.json({ pending: 0, overdue: 0 });
      const { data: docs } = await supabaseAdmin.from("review_docs").select("id, due_date").in("id", ids).eq("closed", false);
      const today = new Date().toISOString().slice(0, 10);
      return NextResponse.json({ pending: (docs ?? []).length, overdue: (docs ?? []).filter((d: any) => d.due_date && d.due_date < today).length });
    }

    // Look up an assignment that belongs to THIS person; anything else is refused.
    const { data: a } = await supabaseAdmin.from("review_assignments").select("*").eq("id", String(b.assignmentId ?? "")).eq("employee_id", session.employeeId).maybeSingle();
    if (!a) return NextResponse.json({ error: "Not found." }, { status: 404 });

    if (b.action === "open") {
      const { data: doc } = await supabaseAdmin.from("review_docs").select("file_path, closed").eq("id", a.doc_id).maybeSingle();
      if (!doc || doc.closed) return NextResponse.json({ error: "Not found." }, { status: 404 });
      const { data, error } = await supabaseAdmin.storage.from(REVIEW_BUCKET).createSignedUrl(doc.file_path, 300);
      if (error || !data) return NextResponse.json({ error: error?.message ?? "Couldn't open the document." }, { status: 500 });
      if (!a.opened_at) await supabaseAdmin.from("review_assignments").update({ opened_at: new Date().toISOString() }).eq("id", a.id);
      return NextResponse.json({ url: data.signedUrl });
    }

    if (b.action === "acknowledge") {
      if (a.reviewed_at) return NextResponse.json({ ok: true });
      if (!a.opened_at) return NextResponse.json({ error: "Open the document first, then confirm that you've reviewed it." }, { status: 400 });
      const initials = String(b.initials ?? "").trim().toUpperCase();
      if (!/^[A-Z]{2,6}$/.test(initials)) return NextResponse.json({ error: "Type your initials (2 to 6 letters)." }, { status: 400 });
      const { error } = await supabaseAdmin.from("review_assignments").update({ reviewed_at: new Date().toISOString(), initials }).eq("id", a.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    console.error("reviews/mine error:", err);
    return NextResponse.json({ error: "Request failed." }, { status: 500 });
  }
}
