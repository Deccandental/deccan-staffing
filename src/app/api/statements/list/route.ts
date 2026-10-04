import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { statementsAccess, MONTH_RE } from "@/lib/statementsAuth";

const COLUMNS = "id, account_kind, account_id, account_name, month, file_name, size_bytes, no_statement, note, uploaded_by, uploaded_at, doc_type, invoice_date, invoice_number, amount, dup_ignored";

// Statements: the accounts that should have one each month, and what's filed for a year.
// Invoices: what's been filed for one month, plus the vendors to pick from.
export async function POST(req: NextRequest) {
  const acc = statementsAccess(req);
  if (!acc) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  if (body.docType === "invoice") {
    const month = MONTH_RE.test(String(body.month)) ? String(body.month) : new Date().toISOString().slice(0, 7);
    const [inv, sources] = await Promise.all([
      supabaseAdmin.from("statement_files").select(COLUMNS).eq("doc_type", "invoice").eq("month", month).order("invoice_date", { ascending: true }),
      supabaseAdmin.from("statement_sources").select("id, name, category, active").order("name"),
    ]);
    if (inv.error) return NextResponse.json({ error: "Invoices aren't set up yet (run the invoices SQL)." }, { status: 500 });
    const vendors = (sources.data ?? []).filter((v: any) => v.active).map((v: any) => ({ id: String(v.id), name: v.name, category: v.category }));
    return NextResponse.json({ role: acc.role, month, files: inv.data ?? [], vendors });
  }

  const year = Number(body.year) || new Date().getFullYear();
  const [banks, cards, debts, sources, files] = await Promise.all([
    supabaseAdmin.from("cash_accounts").select("id, name"),
    supabaseAdmin.from("credit_cards").select("id, name"),
    supabaseAdmin.from("debts").select("id, name, kind, active"),
    supabaseAdmin.from("statement_sources").select("id, name, category, start_month, active").order("name"),
    supabaseAdmin.from("statement_files").select(COLUMNS).eq("doc_type", "statement").like("month", `${year}-%`).order("uploaded_at", { ascending: true }),
  ]);
  if (files.error) return NextResponse.json({ error: "The statements table isn't set up yet." }, { status: 500 });

  const accounts = [
    ...(banks.data ?? []).map((a: any) => ({ kind: "bank", id: String(a.id), name: a.name })),
    ...(cards.data ?? []).map((c: any) => ({ kind: "card", id: String(c.id), name: c.name })),
    ...(debts.data ?? []).filter((d: any) => d.kind !== "revolving" && d.active !== false).map((d: any) => ({ kind: "loan", id: String(d.id), name: d.name })),
  ];
  // Labs and other vendors. A retired one stays visible only while it has statements filed that year.
  const fileRows = files.data ?? [];
  const vendors = (sources.data ?? [])
    .filter((v: any) => v.active || fileRows.some((f: any) => f.account_kind === "vendor" && f.account_id === String(v.id)))
    .map((v: any) => ({ kind: "vendor", id: String(v.id), name: v.name, category: v.category, startMonth: v.start_month, active: v.active }));
  return NextResponse.json({ role: acc.role, year, accounts: [...accounts, ...vendors], files: fileRows });
}
