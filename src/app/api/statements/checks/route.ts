import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { statementsAccess, whoIs, BUCKET } from "@/lib/statementsAuth";

// The check register: a list of every check written. Finance users can add, change and remove entries;
// the CPA can only read it. (Checks that pay an invoice are added automatically when the invoice is marked paid.)

const STATUSES = new Set(["outstanding", "cleared", "void"]);
const toAmount = (v: unknown): number | null => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

export async function POST(req: NextRequest) {
  const acc = statementsAccess(req);
  if (!acc) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const b = await req.json().catch(() => ({}));

  try {
    if (!b.action || b.action === "list") {
      const { data, error } = await supabaseAdmin.from("check_register").select("*")
        .order("check_date", { ascending: false }).order("created_at", { ascending: false }).limit(3000);
      if (error) return NextResponse.json({ error: "The check register isn't set up yet (run the check register SQL)." }, { status: 500 });
      // Attachments, and the invoices each check paid (matched on account and check number, so one check can pay several).
      const [docs, paidInv] = await Promise.all([
        supabaseAdmin.from("check_documents").select("id, check_id, file_name, size_bytes, doc_kind, note, uploaded_by, uploaded_at").order("uploaded_at"),
        supabaseAdmin.from("statement_files").select("id, account_name, invoice_number, amount, paid_check_number, paid_from_id").eq("doc_type", "invoice").eq("paid", true).eq("paid_method", "check").limit(3000),
      ]);
      return NextResponse.json({ role: acc.role, checks: data ?? [], docs: docs.data ?? [], invoices: paidInv.data ?? [] });
    }

    if (acc.role !== "finance") return NextResponse.json({ error: "Not permitted." }, { status: 403 });

    if (b.action === "add") {
      const checkNumber = String(b.checkNumber ?? "").trim().slice(0, 20);
      const checkDate = String(b.checkDate ?? "");
      if (!checkNumber || !/^\d{4}-\d{2}-\d{2}$/.test(checkDate)) return NextResponse.json({ error: "Enter the check number and date." }, { status: 400 });
      const accountId = b.accountId ? String(b.accountId) : null;
      if (!b.allowDuplicate && accountId) {
        const { data: same } = await supabaseAdmin.from("check_register").select("id, payee, amount, check_date, status").eq("account_id", accountId).ilike("check_number", checkNumber.replace(/[%_]/g, "")).neq("status", "void");
        if ((same ?? []).length > 0) return NextResponse.json({ error: "duplicate", duplicate: same![0] }, { status: 409 });
      }
      const { data, error } = await supabaseAdmin.from("check_register").insert({
        check_number: checkNumber, account_kind: accountId ? "bank" : "other", account_id: accountId, account_name: String(b.accountName ?? "").slice(0, 80),
        check_date: checkDate, payee: String(b.payee ?? "").trim().slice(0, 120), amount: toAmount(b.amount), memo: String(b.memo ?? "").trim().slice(0, 200),
        category: String(b.category ?? "").trim().slice(0, 40), created_by: whoIs(acc.session),
      }).select("*").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data });
    }

    if (b.action === "update") {
      // Only a check entered by hand can be edited here. One that paid an invoice is changed from the invoice.
      const { data: row } = await supabaseAdmin.from("check_register").select("id, invoice_id").eq("id", String(b.id)).maybeSingle();
      if (!row) return NextResponse.json({ error: "Check not found." }, { status: 404 });
      if (row.invoice_id) return NextResponse.json({ error: "This check paid an invoice. Change it with Edit on the invoice." }, { status: 400 });
      const checkNumber = String(b.checkNumber ?? "").trim().slice(0, 20);
      const checkDate = String(b.checkDate ?? "");
      if (!checkNumber || !/^\d{4}-\d{2}-\d{2}$/.test(checkDate)) return NextResponse.json({ error: "Enter the check number and date." }, { status: 400 });
      const accountId = b.accountId ? String(b.accountId) : null;
      if (!b.allowDuplicate && accountId) {
        const { data: same } = await supabaseAdmin.from("check_register").select("id, payee, amount, check_date, status").eq("account_id", accountId).ilike("check_number", checkNumber.replace(/[%_]/g, "")).neq("status", "void").neq("id", row.id);
        if ((same ?? []).length > 0) return NextResponse.json({ error: "duplicate", duplicate: same![0] }, { status: 409 });
      }
      const { error } = await supabaseAdmin.from("check_register").update({
        check_number: checkNumber, account_kind: accountId ? "bank" : "other", account_id: accountId, account_name: String(b.accountName ?? "").slice(0, 80),
        check_date: checkDate, payee: String(b.payee ?? "").trim().slice(0, 120), amount: toAmount(b.amount), memo: String(b.memo ?? "").trim().slice(0, 200),
        category: String(b.category ?? "").trim().slice(0, 40),
      }).eq("id", row.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data: null });
    }

    if (b.action === "attachDoc") {
      const checkId = String(b.checkId ?? ""), path = String(b.path ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(checkId) || !/^checks\/[0-9a-f-]{36}\/[a-z0-9-]+\.pdf$/i.test(path) || !path.startsWith(`checks/${checkId}/`)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
      const { data: chk } = await supabaseAdmin.from("check_register").select("id").eq("id", checkId).maybeSingle();
      if (!chk) return NextResponse.json({ error: "Check not found." }, { status: 404 });
      const dir = path.slice(0, path.lastIndexOf("/")), base = path.slice(path.lastIndexOf("/") + 1);
      const { data: found } = await supabaseAdmin.storage.from(BUCKET).list(dir, { search: base });
      if (!found || !found.some((f) => f.name === base)) return NextResponse.json({ error: "The upload didn't complete. Please try again." }, { status: 400 });
      const kind = ["invoice", "statement", "other"].includes(b.kind) ? b.kind : "other";
      const { data, error } = await supabaseAdmin.from("check_documents").insert({
        check_id: checkId, file_path: path, file_name: String(b.fileName ?? base).slice(0, 200), size_bytes: Number(b.size) || null,
        doc_kind: kind, note: String(b.note ?? "").trim().slice(0, 200), uploaded_by: whoIs(acc.session),
      }).select("id, check_id, file_name, size_bytes, doc_kind, note, uploaded_by, uploaded_at").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data });
    }

    if (b.action === "removeDoc") {
      const { data: doc } = await supabaseAdmin.from("check_documents").select("id, file_path").eq("id", String(b.id)).maybeSingle();
      if (!doc) return NextResponse.json({ error: "Not found." }, { status: 404 });
      await supabaseAdmin.storage.from(BUCKET).remove([doc.file_path]);
      const { error } = await supabaseAdmin.from("check_documents").delete().eq("id", doc.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data: null });
    }

    // Link an invoice that's already filed to a check on the register: the invoice is marked paid by that check.
    if (b.action === "linkInvoice") {
      const { data: chk } = await supabaseAdmin.from("check_register").select("*").eq("id", String(b.checkId)).maybeSingle();
      const { data: inv } = await supabaseAdmin.from("statement_files").select("*").eq("id", String(b.invoiceId)).eq("doc_type", "invoice").maybeSingle();
      if (!chk || !inv) return NextResponse.json({ error: "Check or invoice not found." }, { status: 404 });
      if (inv.paid) return NextResponse.json({ error: "That invoice is already marked paid." }, { status: 400 });
      if (chk.status === "void") return NextResponse.json({ error: "That check is void." }, { status: 400 });
      if (!chk.account_id) return NextResponse.json({ error: "This check has no bank account on it. Edit the check and choose one first." }, { status: 400 });
      const { error } = await supabaseAdmin.from("statement_files").update({
        paid: true, paid_date: chk.check_date, paid_method: "check", paid_check_number: chk.check_number,
        paid_from_kind: "bank", paid_from_id: chk.account_id, paid_from_name: chk.account_name, paid_note: "",
      }).eq("id", inv.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      // The check remembers its first invoice (so undoing that payment can void it); more can share the same check number.
      if (!chk.invoice_id) {
        await supabaseAdmin.from("check_register").update({ invoice_id: inv.id, category: "Vendor invoice", payee: chk.payee || inv.account_name, memo: chk.memo || `Invoice ${inv.invoice_number}` }).eq("id", chk.id);
      }
      return NextResponse.json({ data: null });
    }

    if (b.action === "setStatus") {
      if (!STATUSES.has(b.status)) return NextResponse.json({ error: "Bad status." }, { status: 400 });
      const clearedDate = b.status === "cleared" ? (/^\d{4}-\d{2}-\d{2}$/.test(String(b.clearedDate ?? "")) ? b.clearedDate : new Date().toISOString().slice(0, 10)) : null;
      const { error } = await supabaseAdmin.from("check_register").update({ status: b.status, cleared_date: clearedDate }).eq("id", String(b.id));
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data: null });
    }

    if (b.action === "delete") {
      const { error } = await supabaseAdmin.from("check_register").delete().eq("id", String(b.id));
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data: null });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    console.error("statements/checks error:", err);
    return NextResponse.json({ error: `Request failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
