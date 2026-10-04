import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { statementsAccess, whoIs, BUCKET, KINDS, MONTH_RE, CATEGORIES } from "@/lib/statementsAuth";

// Records an uploaded statement or invoice, checks for duplicates, marks "no statement this month",
// manages vendors, or removes a file. Finance users only.

const COLS = "id, account_kind, account_id, account_name, month, file_name, size_bytes, no_statement, note, uploaded_by, uploaded_at, doc_type, invoice_date, invoice_number, amount, dup_ignored";

const toAmount = (v: unknown): number | null => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

export async function POST(req: NextRequest) {
  const acc = statementsAccess(req);
  if (!acc) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (acc.role !== "finance") return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const by = whoIs(acc.session);

  try {
    // ---- Is this a duplicate of something already filed? (Asked BEFORE the file is uploaded.) ----
    if (b.action === "checkDuplicate") {
      const amount = toAmount(b.amount);
      if (b.docType === "invoice") {
        const invNo = String(b.invoiceNumber ?? "").trim().toLowerCase();
        const date = String(b.invoiceDate ?? "");
        const name = String(b.accountName ?? "").trim().toLowerCase();
        const { data } = await supabaseAdmin.from("statement_files").select(COLS).eq("doc_type", "invoice").limit(5000);
        const matches = (data ?? []).filter((r: any) => {
          const sameVendor = b.accountKind === "vendor" && b.accountId ? r.account_id === String(b.accountId) : String(r.account_name).trim().toLowerCase() === name;
          return sameVendor;
        }).map((r: any) => {
          const sameNo = invNo !== "" && String(r.invoice_number ?? "").trim().toLowerCase() === invNo;
          const sameDateAmt = amount != null && r.invoice_date === date && Number(r.amount) === amount;
          return sameNo || sameDateAmt ? { ...r, reason: sameNo ? "the same invoice number" : "the same date and amount" } : null;
        }).filter(Boolean);
        return NextResponse.json({ matches });
      }
      if (!KINDS.has(b.accountKind) || !MONTH_RE.test(String(b.month))) return NextResponse.json({ error: "Bad request." }, { status: 400 });
      const { data } = await supabaseAdmin.from("statement_files").select(COLS).eq("doc_type", "statement").eq("account_kind", b.accountKind)
        .eq("account_id", String(b.accountId)).eq("month", b.month).eq("no_statement", false);
      const matches = (data ?? []).map((r: any) => ({ ...r, reason: amount != null && Number(r.amount) === amount ? "the same month and amount" : "a statement already filed for this month" }));
      return NextResponse.json({ matches });
    }

    if (b.action === "confirm") {
      const path = String(b.path ?? "");
      const isInvoice = b.docType === "invoice";
      const invoiceDate = String(b.invoiceDate ?? "");
      // An invoice's month always comes from its own date, so it can't be filed under a different month.
      const month = isInvoice ? invoiceDate.slice(0, 7) : String(b.month);
      const prefix = `${isInvoice ? "invoices/" : ""}${month.slice(0, 4)}/${month}/`;
      if (!KINDS.has(b.accountKind) || !MONTH_RE.test(month) || !/^(invoices\/)?\d{4}\/\d{4}-\d{2}\/[a-z0-9-]+\.pdf$/.test(path) || !path.startsWith(prefix)
          || (isInvoice && !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate))) {
        return NextResponse.json({ error: "Bad request." }, { status: 400 });
      }
      // The amount is always recorded, and an invoice always has its number.
      const amount = toAmount(b.amount);
      if (amount == null) return NextResponse.json({ error: "Enter the amount." }, { status: 400 });
      const invoiceNumber = String(b.invoiceNumber ?? "").trim().slice(0, 60);
      if (isInvoice && !invoiceNumber) return NextResponse.json({ error: "Enter the invoice number." }, { status: 400 });

      // Make sure the file really arrived before recording it.
      const dir = path.slice(0, path.lastIndexOf("/"));
      const base = path.slice(path.lastIndexOf("/") + 1);
      const { data: found } = await supabaseAdmin.storage.from(BUCKET).list(dir, { search: base });
      if (!found || !found.some((f) => f.name === base)) return NextResponse.json({ error: "The upload didn't complete. Please try again." }, { status: 400 });
      const { data, error } = await supabaseAdmin.from("statement_files").insert({
        account_kind: b.accountKind, account_id: String(b.accountId ?? ""), account_name: String(b.accountName), month,
        file_path: path, file_name: String(b.fileName ?? base).slice(0, 200), size_bytes: Number(b.size) || null, uploaded_by: by,
        amount, dup_ignored: b.dupIgnored === true,
        ...(isInvoice ? { doc_type: "invoice", invoice_date: invoiceDate, invoice_number: invoiceNumber } : {}),
      }).select(COLS).single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data });
    }

    if (b.action === "markNone") {
      if (!KINDS.has(b.accountKind) || !MONTH_RE.test(String(b.month))) return NextResponse.json({ error: "Bad request." }, { status: 400 });
      const { data, error } = await supabaseAdmin.from("statement_files").insert({
        account_kind: b.accountKind, account_id: String(b.accountId), account_name: String(b.accountName), month: b.month,
        no_statement: true, note: String(b.note ?? "").slice(0, 300), uploaded_by: by,
      }).select(COLS).single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data });
    }

    if (b.action === "addSource") {
      const name = String(b.name ?? "").trim().slice(0, 80);
      if (!name || !CATEGORIES.has(b.category) || !MONTH_RE.test(String(b.startMonth))) return NextResponse.json({ error: "Enter a name, a type and a first month." }, { status: 400 });
      const { data, error } = await supabaseAdmin.from("statement_sources").insert({ name, category: b.category, start_month: b.startMonth }).select("id").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data });
    }

    if (b.action === "updateSource") {
      const patch: Record<string, unknown> = {};
      if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim().slice(0, 80);
      if (CATEGORIES.has(b.category)) patch.category = b.category;
      if (typeof b.active === "boolean") patch.active = b.active;
      if (MONTH_RE.test(String(b.startMonth ?? ""))) patch.start_month = b.startMonth;
      if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
      const { error } = await supabaseAdmin.from("statement_sources").update(patch).eq("id", String(b.id));
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data: null });
    }

    if (b.action === "remove") {
      const { data: row } = await supabaseAdmin.from("statement_files").select("id, file_path").eq("id", String(b.id)).maybeSingle();
      if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });
      if (row.file_path) await supabaseAdmin.storage.from(BUCKET).remove([row.file_path]);
      const { error } = await supabaseAdmin.from("statement_files").delete().eq("id", row.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data: null });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    console.error("statements/manage error:", err);
    return NextResponse.json({ error: `Request failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
