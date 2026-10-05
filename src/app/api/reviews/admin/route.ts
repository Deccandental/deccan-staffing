import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { slug, MAX_BYTES } from "@/lib/statementsAuth";
import { adminSession, REVIEW_BUCKET, reviewEmailHtml, sendEmails } from "@/lib/reviewAuth";

// Sending documents to staff for review, and tracking who has reviewed them. Admins only.
export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function staffByIds(ids: number[]) {
  const { data } = await supabaseAdmin.from("staff").select("id, name, email, archived").in("id", ids);
  return (data ?? []).filter((s: any) => !s.archived);
}

// One email per person.
async function emailAssigned(doc: { title: string; note: string; due_date: string | null }, people: { name: string; email: string | null }[]) {
  const withEmail = people.filter((p) => !!p.email);
  const ok = await sendEmails(withEmail.map((p) => ({
    to: p.email as string,
    subject: `Please review: ${doc.title}`,
    html: reviewEmailHtml({ heading: "A document to review", name: p.name, intro: "You've been asked to review the following document.", items: [{ title: doc.title, due: doc.due_date, note: doc.note }] }),
  })));
  return { emailed: ok ? withEmail.length : 0, noEmail: people.filter((p) => !p.email).map((p) => p.name), failed: !ok && withEmail.length > 0 };
}

export async function POST(req: NextRequest) {
  const session = adminSession(req);
  if (!session) return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const by = session.mode === "super" ? "Manager passcode" : (session.employeeName ?? "Admin");

  try {
    if (b.action === "upload-url") {
      const name = String(b.fileName ?? "");
      if (!/\.pdf$/i.test(name)) return NextResponse.json({ error: "Only PDF files can be sent." }, { status: 400 });
      if (!(Number(b.size) > 0) || Number(b.size) > MAX_BYTES) return NextResponse.json({ error: "File is too large (15 MB limit)." }, { status: 400 });
      const docId = crypto.randomUUID();
      const path = `reviews/${docId}/${slug(name.replace(/\.pdf$/i, ""))}-${crypto.randomUUID().slice(0, 8)}.pdf`;
      const { data, error } = await supabaseAdmin.storage.from(REVIEW_BUCKET).createSignedUploadUrl(path);
      if (error || !data) return NextResponse.json({ error: error?.message ?? "Couldn't start the upload." }, { status: 500 });
      return NextResponse.json({ docId, path, token: data.token });
    }

    if (b.action === "create") {
      const docId = String(b.docId ?? ""), path = String(b.path ?? "");
      const title = String(b.title ?? "").trim().slice(0, 120);
      const ids: number[] = Array.isArray(b.employeeIds) ? [...new Set<number>(b.employeeIds.map(Number).filter((n: number) => Number.isFinite(n)))] : [];
      const dueDate = DATE_RE.test(String(b.dueDate ?? "")) ? String(b.dueDate) : null;
      if (!title) return NextResponse.json({ error: "Give the document a title." }, { status: 400 });
      if (ids.length === 0) return NextResponse.json({ error: "Choose at least one person to review it." }, { status: 400 });
      if (!/^[0-9a-f-]{36}$/i.test(docId) || !/^reviews\/[0-9a-f-]{36}\/[a-z0-9-]+\.pdf$/i.test(path) || !path.startsWith(`reviews/${docId}/`)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
      const dir = path.slice(0, path.lastIndexOf("/")), base = path.slice(path.lastIndexOf("/") + 1);
      const { data: found } = await supabaseAdmin.storage.from(REVIEW_BUCKET).list(dir, { search: base });
      if (!found || !found.some((f) => f.name === base)) return NextResponse.json({ error: "The upload didn't complete. Please try again." }, { status: 400 });

      const people = await staffByIds(ids);
      if (people.length === 0) return NextResponse.json({ error: "None of those people are active staff." }, { status: 400 });
      const note = String(b.note ?? "").trim().slice(0, 500);
      const { error } = await supabaseAdmin.from("review_docs").insert({ id: docId, title, note, file_path: path, file_name: String(b.fileName ?? base).slice(0, 200), size_bytes: Number(b.size) || null, due_date: dueDate, created_by: by });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await supabaseAdmin.from("review_assignments").insert(people.map((p: any) => ({ doc_id: docId, employee_id: p.id, employee_name: p.name })));
      const mail = await emailAssigned({ title, note, due_date: dueDate }, people);
      return NextResponse.json({ id: docId, people: people.length, ...mail });
    }

    if (b.action === "list") {
      const { data: docs, error } = await supabaseAdmin.from("review_docs").select("*").eq("closed", false).order("created_at", { ascending: false });
      if (error) return NextResponse.json({ error: "Documents to review aren't set up yet (run the review documents SQL)." }, { status: 500 });
      const ids = (docs ?? []).map((d: any) => d.id);
      const { data: assigns } = ids.length ? await supabaseAdmin.from("review_assignments").select("*").in("doc_id", ids).order("employee_name") : { data: [] as any[] };
      return NextResponse.json({ docs: docs ?? [], assignments: assigns ?? [] });
    }

    if (b.action === "addPeople") {
      const { data: doc } = await supabaseAdmin.from("review_docs").select("*").eq("id", String(b.docId)).maybeSingle();
      if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });
      const ids: number[] = Array.isArray(b.employeeIds) ? b.employeeIds.map(Number).filter((n: number) => Number.isFinite(n)) : [];
      const { data: have } = await supabaseAdmin.from("review_assignments").select("employee_id").eq("doc_id", doc.id);
      const haveIds = new Set((have ?? []).map((a: any) => a.employee_id));
      const people = (await staffByIds(ids)).filter((p: any) => !haveIds.has(p.id));
      if (people.length === 0) return NextResponse.json({ error: "Everyone chosen already has this document." }, { status: 400 });
      await supabaseAdmin.from("review_assignments").insert(people.map((p: any) => ({ doc_id: doc.id, employee_id: p.id, employee_name: p.name })));
      const mail = await emailAssigned(doc, people);
      return NextResponse.json({ people: people.length, ...mail });
    }

    if (b.action === "remind") {
      const { data: doc } = await supabaseAdmin.from("review_docs").select("*").eq("id", String(b.docId)).maybeSingle();
      if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });
      const { data: pend } = await supabaseAdmin.from("review_assignments").select("id, employee_id, employee_name").eq("doc_id", doc.id).is("reviewed_at", null);
      if (!pend || pend.length === 0) return NextResponse.json({ error: "Everyone has reviewed this document." }, { status: 400 });
      const people = await staffByIds(pend.map((a: any) => a.employee_id));
      const ok = await sendEmails(people.filter((p: any) => !!p.email).map((p: any) => ({
        to: p.email, subject: `Reminder: please review ${doc.title}`,
        html: reviewEmailHtml({ heading: "Reminder: a document to review", name: p.name, intro: "This document is still waiting for your review.", items: [{ title: doc.title, due: doc.due_date, note: doc.note }] }),
      })));
      if (ok) await supabaseAdmin.from("review_assignments").update({ reminder_sent_at: new Date().toISOString() }).eq("doc_id", doc.id).is("reviewed_at", null);
      return NextResponse.json({ reminded: people.filter((p: any) => !!p.email).length, noEmail: people.filter((p: any) => !p.email).map((p: any) => p.name), failed: !ok });
    }

    if (b.action === "download") {
      const { data: doc } = await supabaseAdmin.from("review_docs").select("file_path, file_name").eq("id", String(b.docId)).maybeSingle();
      if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });
      const { data, error } = await supabaseAdmin.storage.from(REVIEW_BUCKET).createSignedUrl(doc.file_path, 120);
      if (error || !data) return NextResponse.json({ error: error?.message ?? "Couldn't create the link." }, { status: 500 });
      return NextResponse.json({ url: data.signedUrl });
    }

    if (b.action === "setDue") {
      const dueDate = DATE_RE.test(String(b.dueDate ?? "")) ? String(b.dueDate) : null;
      const { error } = await supabaseAdmin.from("review_docs").update({ due_date: dueDate }).eq("id", String(b.docId));
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (b.action === "removePerson") {
      const { error } = await supabaseAdmin.from("review_assignments").delete().eq("id", String(b.assignmentId));
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (b.action === "remove") {
      const { data: doc } = await supabaseAdmin.from("review_docs").select("id, file_path").eq("id", String(b.docId)).maybeSingle();
      if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });
      await supabaseAdmin.storage.from(REVIEW_BUCKET).remove([doc.file_path]);
      const { error } = await supabaseAdmin.from("review_docs").delete().eq("id", doc.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    console.error("reviews/admin error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Request failed." }, { status: 500 });
  }
}
