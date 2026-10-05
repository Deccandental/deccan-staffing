import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { statementsAccess, MONTH_RE, KINDS } from "@/lib/statementsAuth";

const nextMonthStart = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 1)).toISOString().slice(0, 10);
const COLUMNS = "id, account_kind, account_id, account_name, month, file_name, size_bytes, no_statement, note, uploaded_by, uploaded_at, doc_type, invoice_date, invoice_number, amount, dup_ignored, paid, paid_date, matched_bill_id, matched_due_date, category, paid_from_name, paid_note, paid_method, paid_check_number, paid_from_kind, paid_from_id";

// Statements: the accounts that should have one each month, what's filed for a year, and what Cash Flow
// already records as each month's statement balance.
// One account's statements: for the "Statements" view on an Overview card.
// Invoices: one month's, or every unpaid one (for Need to collect), plus the vendors to pick from.
export async function POST(req: NextRequest) {
  const acc = statementsAccess(req);
  if (!acc) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  if (body.docType === "invoice") {
    const month = MONTH_RE.test(String(body.month)) ? String(body.month) : new Date().toISOString().slice(0, 7);
    const [inv, sources] = await Promise.all([
      // "unpaid" lists every month's unpaid invoices; otherwise the month's invoices (dated or paid in it).
      body.unpaid
        ? supabaseAdmin.from("statement_files").select(COLUMNS).eq("doc_type", "invoice").eq("paid", false).order("invoice_date", { ascending: true }).limit(1000)
        // Everything that belongs to the month: invoices dated in it, plus invoices paid in it (even if dated earlier).
        : supabaseAdmin.from("statement_files").select(COLUMNS).eq("doc_type", "invoice")
            .or(`month.eq.${month},and(paid.eq.true,paid_date.gte.${month}-01,paid_date.lt.${nextMonthStart(month)})`)
            .order("invoice_date", { ascending: true }),
      supabaseAdmin.from("statement_sources").select("*").order("name"),
    ]);
    if (inv.error) return NextResponse.json({ error: "Invoices aren't set up yet (run the invoices SQL)." }, { status: 500 });
    const vendors = (sources.data ?? []).filter((v: any) => v.active).map((v: any) => ({ id: String(v.id), name: v.name, category: v.category }));
    // The whole directory (including retired ones) for the Vendors panel.
    const vendorsAll = (sources.data ?? []).map((v: any) => ({ id: String(v.id), name: v.name, category: v.category, active: v.active, expectsStatement: v.expects_statement !== false }));
    // Every category already used on an invoice, so a new one typed once shows up in the list from then on.
    const { data: used } = await supabaseAdmin.from("statement_files").select("category").eq("doc_type", "invoice").neq("category", "").limit(3000);
    const categories = [...new Set((used ?? []).map((r: any) => String(r.category)))].sort();
    // Names typed on earlier invoices that aren't saved as vendors, offered as suggestions so they aren't retyped.
    const { data: typed } = await supabaseAdmin.from("statement_files").select("account_name").eq("doc_type", "invoice").eq("account_kind", "other").limit(3000);
    const known = new Set(vendorsAll.map((v: any) => String(v.name).trim().toLowerCase()));
    const usedNames = [...new Set((typed ?? []).map((r: any) => String(r.account_name).trim()))].filter((n) => n && !known.has(n.toLowerCase())).sort();
    return NextResponse.json({ role: acc.role, month, files: inv.data ?? [], vendors, vendorsAll, usedNames, categories });
  }

  // One account's filed statements, newest month first.
  if (body.accountKind && body.accountId) {
    if (!KINDS.has(body.accountKind)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    const { data, error } = await supabaseAdmin.from("statement_files").select(COLUMNS).eq("doc_type", "statement")
      .eq("account_kind", body.accountKind).eq("account_id", String(body.accountId)).eq("no_statement", false).order("month", { ascending: false }).limit(60);
    if (error) return NextResponse.json({ error: "The statements table isn't set up yet." }, { status: 500 });
    return NextResponse.json({ role: acc.role, files: data ?? [] });
  }

  const year = Number(body.year) || new Date().getFullYear();
  const [banks, cards, debts, sources, files, bankStm, cardStm, debtStm] = await Promise.all([
    supabaseAdmin.from("cash_accounts").select("*"),
    supabaseAdmin.from("credit_cards").select("*"),
    supabaseAdmin.from("debts").select("id, name, kind, active"),
    supabaseAdmin.from("statement_sources").select("*").order("name"),
    supabaseAdmin.from("statement_files").select(COLUMNS).eq("doc_type", "statement").like("month", `${year}-%`).order("uploaded_at", { ascending: true }),
    supabaseAdmin.from("bank_statement_entries").select("cash_account_id, month, balance").like("month", `${year}-%`),
    supabaseAdmin.from("card_statement_entries").select("credit_card_id, month, balance").like("month", `${year}-%`),
    supabaseAdmin.from("debt_statement_entries").select("debt_id, month, balance").like("month", `${year}-%`),
  ]);
  if (files.error) return NextResponse.json({ error: "The statements table isn't set up yet." }, { status: 500 });

  // A closed account or card is left off the checklist, except for a year in which it has statements filed.
  const filedFor = (kind: string, id: string) => (files.data ?? []).some((f: any) => f.account_kind === kind && f.account_id === id);
  const accounts = [
    ...(banks.data ?? []).filter((a: any) => a.active !== false || filedFor("bank", String(a.id))).map((a: any) => ({ kind: "bank", id: String(a.id), name: a.name })),
    ...(cards.data ?? []).filter((c: any) => c.active !== false || filedFor("card", String(c.id))).map((c: any) => ({ kind: "card", id: String(c.id), name: c.name })),
    ...(debts.data ?? []).filter((d: any) => d.kind !== "revolving" && d.active !== false).map((d: any) => ({ kind: "loan", id: String(d.id), name: d.name })),
  ];
  // Labs and other vendors. A retired one stays visible only while it has statements filed that year.
  const fileRows = files.data ?? [];
  const vendors = (sources.data ?? [])
    .filter((v: any) => (v.active && v.expects_statement !== false) || fileRows.some((f: any) => f.account_kind === "vendor" && f.account_id === String(v.id)))
    .map((v: any) => ({ kind: "vendor", id: String(v.id), name: v.name, category: v.category, startMonth: v.start_month, active: v.active }));

  // What Cash Flow already holds as each month's statement balance, so the amount can be filled in for you.
  const cfBalances: Record<string, number> = {};
  for (const r of bankStm.data ?? []) cfBalances[`bank:${r.cash_account_id}:${r.month}`] = Number(r.balance);
  for (const r of cardStm.data ?? []) cfBalances[`card:${r.credit_card_id}:${r.month}`] = Number(r.balance);
  for (const r of debtStm.data ?? []) cfBalances[`loan:${r.debt_id}:${r.month}`] = Number(r.balance);

  return NextResponse.json({ role: acc.role, year, accounts: [...accounts, ...vendors], files: fileRows, cfBalances });
}
