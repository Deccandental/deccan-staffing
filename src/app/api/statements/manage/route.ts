import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { statementsAccess, whoIs, BUCKET, KINDS, MONTH_RE, CATEGORIES } from "@/lib/statementsAuth";

// Records an uploaded statement or invoice, checks for duplicates, marks "no statement this month",
// manages vendors, or removes a file. Finance users only.

const COLS = "id, account_kind, account_id, account_name, month, file_name, size_bytes, no_statement, note, uploaded_by, uploaded_at, doc_type, invoice_date, invoice_number, amount, dup_ignored, paid, paid_date, matched_bill_id, matched_due_date, category, paid_from_name, paid_note, paid_method, paid_check_number, paid_from_kind, paid_from_id";

// What Cash Flow holds as this account's statement balance for a month (null if nothing).
async function cashFlowBalance(kind: string, id: string, month: string): Promise<number | null> {
  const t = kind === "bank" ? ["bank_statement_entries", "cash_account_id"] : kind === "card" ? ["card_statement_entries", "credit_card_id"] : kind === "loan" ? ["debt_statement_entries", "debt_id"] : null;
  if (!t) return null;
  const { data } = await supabaseAdmin.from(t[0]).select("balance").eq(t[1], id).eq("month", month).maybeSingle();
  return data ? Number(data.balance) : null;
}

// Record a filed statement's amount as that month's statement balance in Cash Flow, so it's entered once.
async function syncStatementBalance(kind: string, id: string, month: string, balance: number): Promise<boolean> {
  const now = new Date().toISOString();
  if (kind === "loan") {
    const { error } = await supabaseAdmin.from("debt_statement_entries").upsert({ debt_id: id, month, balance, entered_at: now }, { onConflict: "debt_id,month" });
    return !error;
  }
  const cfg = kind === "bank" ? { table: "bank_statement_entries", col: "cash_account_id", acct: "cash_accounts" }
            : kind === "card" ? { table: "card_statement_entries", col: "credit_card_id", acct: "credit_cards" } : null;
  if (!cfg) return false;
  const { error } = await supabaseAdmin.from(cfg.table).upsert({ [cfg.col]: id, month, balance, entered_at: now }, { onConflict: `${cfg.col},month` });
  if (error) return false;
  // The account's "current statement" figure follows the newest month only.
  const { data: newest } = await supabaseAdmin.from(cfg.table).select("month").eq(cfg.col, id).order("month", { ascending: false }).limit(1).maybeSingle();
  if (newest?.month === month) await supabaseAdmin.from(cfg.acct).update({ statement_balance: balance, statement_balance_updated_at: now }).eq("id", id);
  return true;
}

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
      const cfBalance = await cashFlowBalance(b.accountKind, String(b.accountId), String(b.month));
      return NextResponse.json({ matches, cfBalance });
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
        ...(isInvoice ? {
          doc_type: "invoice", invoice_date: invoiceDate, invoice_number: invoiceNumber, category: String(b.category ?? "").trim().slice(0, 40),
          ...(b.matchedBillId && /^\d{4}-\d{2}-\d{2}$/.test(String(b.matchedDueDate ?? "")) ? { matched_bill_id: String(b.matchedBillId), matched_due_date: b.matchedDueDate } : {}),
        } : {}),
      }).select(COLS).single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      // A statement's amount becomes that month's statement balance in Cash Flow.
      const synced = !isInvoice && b.accountKind !== "vendor" && b.accountKind !== "other" ? await syncStatementBalance(b.accountKind, String(b.accountId), month, amount) : false;
      return NextResponse.json({ data, synced });
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
      const { data, error } = await supabaseAdmin.from("statement_sources").insert({ name, category: b.category, start_month: b.startMonth, expects_statement: b.expectsStatement !== false }).select("id").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data });
    }

    if (b.action === "updateSource") {
      const patch: Record<string, unknown> = {};
      if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim().slice(0, 80);
      if (CATEGORIES.has(b.category)) patch.category = b.category;
      if (typeof b.active === "boolean") patch.active = b.active;
      if (typeof b.expectsStatement === "boolean") patch.expects_statement = b.expectsStatement;
      if (MONTH_RE.test(String(b.startMonth ?? ""))) patch.start_month = b.startMonth;
      if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
      const { error } = await supabaseAdmin.from("statement_sources").update(patch).eq("id", String(b.id));
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data: null });
    }

    if (b.action === "mergeSource") {
      const fromId = String(b.fromId ?? ""), intoId = String(b.intoId ?? "");
      if (!fromId || !intoId || fromId === intoId) return NextResponse.json({ error: "Choose a different vendor to merge into." }, { status: 400 });
      const { data: srcs } = await supabaseAdmin.from("statement_sources").select("id, name").in("id", [fromId, intoId]);
      const from = (srcs ?? []).find((x: any) => String(x.id) === fromId), into = (srcs ?? []).find((x: any) => String(x.id) === intoId);
      if (!from || !into) return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
      // Everything filed under the duplicate moves to the vendor being kept, so its invoices, statements and
      // duplicate warnings all sit under one name. The kept vendor's own settings are left as they are.
      const { data: moved, error: e1 } = await supabaseAdmin.from("statement_files").update({ account_id: intoId, account_name: into.name }).eq("account_kind", "vendor").eq("account_id", fromId).select("id");
      if (e1) return NextResponse.json({ error: e1.message }, { status: 400 });
      const { error: e2 } = await supabaseAdmin.from("statement_sources").delete().eq("id", fromId);
      if (e2) return NextResponse.json({ error: e2.message }, { status: 400 });
      return NextResponse.json({ moved: (moved ?? []).length, into: into.name, from: from.name });
    }

    if (b.action === "setInvoiceCategory") {
      const { error } = await supabaseAdmin.from("statement_files").update({ category: String(b.category ?? "").trim().slice(0, 40) }).eq("id", String(b.id)).eq("doc_type", "invoice");
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data: null });
    }

    if (b.action === "markInvoicePaid") {
      const paid = b.paid === true;
      const id = String(b.id);
      const paidDate = paid && /^\d{4}-\d{2}-\d{2}$/.test(String(b.paidDate ?? "")) ? b.paidDate : paid ? new Date().toISOString().slice(0, 10) : null;
      const method = paid && ["check", "ach", "card", "other"].includes(b.method) ? b.method : null;
      const checkNumber = method === "check" ? String(b.checkNumber ?? "").trim().slice(0, 20) : "";
      const accountId = b.paidFromId ? String(b.paidFromId) : null;

      // A check already logged for this invoice (when editing a payment that was already marked paid).
      const { data: linkedRows } = await supabaseAdmin.from("check_register").select("id, memo").eq("invoice_id", id).neq("status", "void");
      const mine = new Set((linkedRows ?? []).map((l: any) => l.id));

      // Paying by check: it needs a number and a bank account, and the number must not already be on the register.
      if (paid && method === "check") {
        if (!checkNumber) return NextResponse.json({ error: "Enter the check number." }, { status: 400 });
        if (b.paidFromKind !== "bank" || !accountId) return NextResponse.json({ error: "Choose the bank account the check is drawn on." }, { status: 400 });
        if (!b.allowDuplicateCheck) {
          const { data: same } = await supabaseAdmin.from("check_register").select("id, payee, amount, check_date, status").eq("account_id", accountId).ilike("check_number", checkNumber.replace(/[%_]/g, "")).neq("status", "void");
          // This invoice's own check doesn't count as a duplicate of itself.
          const others = (same ?? []).filter((r: any) => !mine.has(r.id));
          if (others.length > 0) return NextResponse.json({ error: "duplicate", duplicate: others[0] }, { status: 409 });
        }
      }

      // Which account it was paid from, and an optional note. Both are cleared if the payment is undone.
      const from = paid ? {
        paid_from_kind: ["bank", "card", "other"].includes(b.paidFromKind) ? b.paidFromKind : null,
        paid_from_id: accountId,
        paid_from_name: String(b.paidFromName ?? "").trim().slice(0, 80),
        paid_note: String(b.paidNote ?? "").trim().slice(0, 120),
        paid_method: method, paid_check_number: checkNumber,
      } : { paid_from_kind: null, paid_from_id: null, paid_from_name: "", paid_note: "", paid_method: null, paid_check_number: "" };
      const { data: inv, error } = await supabaseAdmin.from("statement_files").update({ paid, paid_date: paidDate, ...from }).eq("id", id).eq("doc_type", "invoice").select("account_name, invoice_number, amount").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });

      const checkFields = {
        check_number: checkNumber, account_kind: "bank", account_id: accountId, account_name: from.paid_from_name, check_date: paidDate,
        payee: inv?.account_name ?? "", amount: inv?.amount ?? null, memo: `Invoice ${inv?.invoice_number ?? ""}`.trim(), category: "Vendor invoice",
      };
      if (paid && method === "check") {
        // The check is on the register, linked to this invoice: updated if it was already there, added if not.
        if ((linkedRows ?? []).length > 0) await supabaseAdmin.from("check_register").update(checkFields).eq("id", linkedRows![0].id);
        else await supabaseAdmin.from("check_register").insert({ ...checkFields, invoice_id: id, created_by: whoIs(acc.session) });
      } else {
        // No longer a check (the payment was undone, or changed to another method): the old check is voided.
        // The number stays on the register as used.
        for (const c of linkedRows ?? []) await supabaseAdmin.from("check_register").update({ status: "void", memo: `${c.memo} (${paid ? "payment method changed" : "payment undone"})`.trim() }).eq("id", c.id);
      }
      return NextResponse.json({ data: null });
    }

    if (b.action === "matchInvoice") {
      const link = b.billId && /^\d{4}-\d{2}-\d{2}$/.test(String(b.dueDate ?? ""));
      const { error } = await supabaseAdmin.from("statement_files").update(link ? { matched_bill_id: String(b.billId), matched_due_date: b.dueDate } : { matched_bill_id: null, matched_due_date: null }).eq("id", String(b.id)).eq("doc_type", "invoice");
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
