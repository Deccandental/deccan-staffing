import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { sendWeeklyCashDigest } from "@/lib/cashflowEmail";
import { buildStaleItems } from "@/lib/staleness";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else {
    console.warn("CRON_SECRET is not set — /api/cashflow/weekly-digest is unauthenticated");
  }

  // Same overdue rules as the Cash Flow page (src/lib/staleness.ts), so the
  // email never flags something the page doesn't, or the other way round.
  const { data: accounts } = await supabase.from("cash_accounts").select("*");
  const { data: cards } = await supabase.from("credit_cards").select("*");
  const { data: debts } = await supabase.from("debts").select("*");
  const { data: balanceRows } = await supabase.from("balance_checks").select("*").order("checked_at", { ascending: false });
  const { data: bankStmts } = await supabase.from("bank_statement_entries").select("cash_account_id, month");
  const { data: cardStmts } = await supabase.from("card_statement_entries").select("credit_card_id, month");
  const { data: loanStmts } = await supabase.from("debt_statement_entries").select("debt_id, month");
  const { data: latestReview } = await supabase.from("weekly_cash_reviews").select("review_date").order("review_date", { ascending: false }).limit(1).maybeSingle();
  const { data: latestAr } = await supabase.from("ar_aging_entries").select("entry_date").order("entry_date", { ascending: false }).limit(1).maybeSingle();

  const latestChecked: Record<string, string> = {};
  for (const row of balanceRows ?? []) {
    if (!latestChecked[row.account_name]) latestChecked[row.account_name] = row.checked_at;
  }
  const statements: Record<string, { month: string }[]> = {};
  const push = (id: string, month: string) => { (statements[id] ??= []).push({ month }); };
  for (const r of bankStmts ?? []) push(r.cash_account_id, r.month);
  for (const r of cardStmts ?? []) push(r.credit_card_id, r.month);
  for (const r of loanStmts ?? []) push(r.debt_id, r.month);

  const stale = buildStaleItems({
    accounts: (accounts ?? []).map((a: any) => ({ id: a.id, name: a.name })),
    cards: (cards ?? []).map((c: any) => ({ id: c.id, name: c.name, approxClosingDay: c.approx_closing_day })),
    loans: (debts ?? []).filter((d: any) => d.kind !== "revolving").map((d: any) => ({ id: d.id, name: d.name })),
    latestChecked,
    statements,
    reviewDate: latestReview?.review_date ?? null,
    arDate: latestAr?.entry_date ?? null,
  });
  const items = stale.map((it) => `<strong>${it.name}</strong> — ${it.warnings.join("; ")}.`);

  // Statements for last month that still haven't been filed (from the 8th on). Names only, nothing sensitive.
  const nowD = new Date();
  if (nowD.getDate() >= 8) {
    const prev = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1);
    const pm = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
    const { data: sf, error: sfErr } = await supabase.from("statement_files").select("account_kind, account_id").eq("doc_type", "statement").eq("month", pm);
    if (!sfErr) {
      const filed = new Set((sf ?? []).map((r: any) => `${r.account_kind}:${r.account_id}`));
      const expected = [
        ...(accounts ?? []).map((a: any) => ({ key: `bank:${a.id}`, name: a.name })),
        ...(cards ?? []).map((c: any) => ({ key: `card:${c.id}`, name: c.name })),
        ...(debts ?? []).filter((d: any) => d.kind !== "revolving" && d.active !== false).map((d: any) => ({ key: `loan:${d.id}`, name: d.name })),
      ];
      const { data: srcRows } = await supabase.from("statement_sources").select("id, name, start_month").eq("active", true);
      for (const v of srcRows ?? []) if (v.start_month <= pm) expected.push({ key: `vendor:${v.id}`, name: v.name });
      const missing = expected.filter((e) => !filed.has(e.key)).map((e) => e.name);
      if (missing.length > 0) {
        items.push(`<strong>${prev.toLocaleDateString("en-US", { month: "long" })} statements not filed yet</strong> — ${missing.join(", ")}. File them on the Statements page.`);
      }
    }
  }

  const sent = await sendWeeklyCashDigest(items);
  return NextResponse.json({ ok: true, itemCount: items.length, sent });
}
