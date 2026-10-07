import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { statementsAccess, MONTH_RE } from "@/lib/statementsAuth";
import { applyAutopay, practiceToday } from "@/lib/statementsAutopay";

// Everything the single monthly Statements list needs, in one call:
//   - the statements and invoices that belong to the month (dated in it, still unpaid from earlier months,
//     or paid in it), the vendors, their remembered settings, any credits on file with a vendor,
//     the accounts to pay from, and the bank / card / loan accounts whose statements are filed each month.
// Finance and the CPA can both read it. Changes go through /api/statements/manage (finance only).

const nextMonthStart = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 1)).toISOString().slice(0, 10);
const prevMonthOf = (m: string) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)) - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export async function POST(req: NextRequest) {
  const acc = statementsAccess(req);
  if (!acc) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const today = practiceToday();
  const currentMonth = today.slice(0, 7);
  const month = MONTH_RE.test(String(body.month)) ? String(body.month) : currentMonth;

  await applyAutopay();

  const needSql = "The statements list needs its database update first (run the statements SQL in Supabase).";
  const [inMonth, carry, paidHere, sources, prefs] = await Promise.all([
    supabaseAdmin.from("statement_files").select("*").eq("month", month).order("uploaded_at", { ascending: true }),
    supabaseAdmin.from("statement_files").select("*").eq("doc_type", "invoice").eq("paid", false).eq("no_statement", false).lt("month", month),
    supabaseAdmin.from("statement_files").select("*").eq("paid", true).gte("paid_date", `${month}-01`).lt("paid_date", nextMonthStart(month)).neq("month", month),
    supabaseAdmin.from("statement_sources").select("*").order("name"),
    supabaseAdmin.from("statement_prefs").select("*"),
  ]);
  if (inMonth.error || carry.error || paidHere.error || sources.error) return NextResponse.json({ error: "Couldn't load statements." }, { status: 500 });
  if (prefs.error) return NextResponse.json({ error: needSql }, { status: 500 });

  const pdMonth = (r: any) => (r.paid && r.paid_date ? String(r.paid_date).slice(0, 7) : null);
  const keyOf = (r: any) => `${r.account_kind}:${r.account_id}`;

  // Which vendors / accounts already have something dated in this month (even if it was paid in a later month
  // and so lives there now), and which were skipped. These decide who is still "waiting".
  const datedIds = new Set<string>();
  const skippedIds = new Set<string>();
  for (const r of (inMonth.data ?? []) as any[]) (r.no_statement ? skippedIds : datedIds).add(keyOf(r));

  // A paid invoice lives in the month it was paid; everything else stays in its own month.
  const mine = ((inMonth.data ?? []) as any[]).filter((r) => r.doc_type !== "invoice" || !r.paid || !pdMonth(r) || pdMonth(r) === month);
  const seen = new Set<string>();
  const files: any[] = [];
  for (const r of [...mine, ...((carry.data ?? []) as any[]), ...((paidHere.data ?? []) as any[])]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const { file_path, ...rest } = r; // the storage path never leaves the server
    void file_path;
    files.push(rest);
  }

  // Credits already used on each statement shown (so the amount still due is exact).
  const ids = files.map((f) => String(f.id));
  const applied: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: used } = await supabaseAdmin.from("statement_files").select("credit_applied_to, overpaid_credit").in("credit_applied_to", ids);
    for (const u of (used ?? []) as any[]) applied[String(u.credit_applied_to)] = (applied[String(u.credit_applied_to)] ?? 0) + Number(u.overpaid_credit ?? 0);
  }
  for (const f of files) f.credit_applied = applied[String(f.id)] ?? 0;

  // Credit available with each vendor (an overpayment carried forward and not used yet).
  const credits: Record<string, number> = {};
  const { data: cr } = await supabaseAdmin.from("statement_files").select("account_id, overpaid_credit").gt("overpaid_credit", 0).is("credit_applied_to", null);
  for (const c of (cr ?? []) as any[]) credits[String(c.account_id)] = (credits[String(c.account_id)] ?? 0) + Number(c.overpaid_credit);

  // Each vendor's first month on file and the category it was last filed under.
  const history: Record<string, { firstMonth: string; lastMonth: string; lastCategory: string }> = {};
  const { data: hist } = await supabaseAdmin.from("statement_files").select("account_id, month, category").eq("account_kind", "vendor").eq("no_statement", false).limit(10000);
  const lastCatMonth: Record<string, string> = {};
  for (const h of (hist ?? []) as any[]) {
    const id = String(h.account_id);
    const cur = history[id] ?? { firstMonth: h.month, lastMonth: h.month, lastCategory: "" };
    if (h.month < cur.firstMonth) cur.firstMonth = h.month;
    if (h.month > cur.lastMonth) cur.lastMonth = h.month;
    if (h.category && (!lastCatMonth[id] || h.month >= lastCatMonth[id])) { cur.lastCategory = h.category; lastCatMonth[id] = h.month; }
    history[id] = cur;
  }

  // Bank accounts and cards to pay from, and the account statements that are filed every month.
  const [banks, cards, debts, bankStm, cardStm, debtStm, checks] = await Promise.all([
    supabaseAdmin.from("cash_accounts").select("*"),
    supabaseAdmin.from("credit_cards").select("*"),
    supabaseAdmin.from("debts").select("id, name, kind, active"),
    supabaseAdmin.from("bank_statement_entries").select("cash_account_id, balance").eq("month", month),
    supabaseAdmin.from("card_statement_entries").select("credit_card_id, balance").eq("month", month),
    supabaseAdmin.from("debt_statement_entries").select("debt_id, balance").eq("month", month),
    supabaseAdmin.from("check_register").select("account_id, check_number").limit(5000),
  ]);
  const filedHere = (kind: string, id: string) => files.some((f) => f.account_kind === kind && f.account_id === id);
  const accounts = [
    ...(banks.data ?? []).filter((a: any) => a.active !== false || filedHere("bank", String(a.id))).map((a: any) => ({ kind: "bank", id: String(a.id), name: a.name })),
    ...(cards.data ?? []).filter((c: any) => c.active !== false || filedHere("card", String(c.id))).map((c: any) => ({ kind: "card", id: String(c.id), name: c.name })),
    ...(debts.data ?? []).filter((d: any) => d.kind !== "revolving" && d.active !== false).map((d: any) => ({ kind: "loan", id: String(d.id), name: d.name })),
  ];
  const payAccounts = [
    ...(banks.data ?? []).filter((a: any) => a.active !== false).map((a: any) => ({ kind: "bank", id: String(a.id), name: a.name })),
    ...(cards.data ?? []).filter((c: any) => c.active !== false).map((c: any) => ({ kind: "card", id: String(c.id), name: c.name })),
  ];
  const cfBalances: Record<string, number> = {};
  for (const r of (bankStm.data ?? []) as any[]) cfBalances[`bank:${r.cash_account_id}`] = Number(r.balance);
  for (const r of (cardStm.data ?? []) as any[]) cfBalances[`card:${r.credit_card_id}`] = Number(r.balance);
  for (const r of (debtStm.data ?? []) as any[]) cfBalances[`loan:${r.debt_id}`] = Number(r.balance);

  // The highest check number used on each account, so the next one can be filled in.
  const lastCheck: Record<string, number> = {};
  for (const c of (checks.data ?? []) as any[]) {
    const n = /^\d+$/.test(String(c.check_number ?? "").trim()) ? Number(String(c.check_number).trim()) : NaN;
    if (c.account_id && Number.isFinite(n) && n > (lastCheck[String(c.account_id)] ?? 0)) lastCheck[String(c.account_id)] = n;
  }

  // In the current month, remind about last month's account statements that never arrived.
  const prevMonth = prevMonthOf(month);
  let prevMissing: string[] = [];
  if (month === currentMonth) {
    const { data: prev } = await supabaseAdmin.from("statement_files").select("account_kind, account_id").eq("month", prevMonth).in("account_kind", ["bank", "card", "loan"]);
    const have = new Set(((prev ?? []) as any[]).map((r) => keyOf(r)));
    prevMissing = accounts.filter((a) => !have.has(`${a.kind}:${a.id}`)).map((a) => a.name);
  }

  return NextResponse.json({
    role: acc.role, today, month, currentMonth, prevMonth, prevMissing,
    files, datedIds: [...datedIds], skippedIds: [...skippedIds],
    sources: ((sources.data ?? []) as any[]).map((s) => ({ id: String(s.id), name: s.name, category: s.category, active: s.active !== false, startMonth: s.start_month ?? "", expects: s.expects_statement !== false })),
    prefs: ((prefs.data ?? []) as any[]).map((p) => ({ key: p.key, category: p.category ?? "", autopay: !!p.autopay, autopayFromKind: p.autopay_from_kind ?? "", autopayFromId: p.autopay_from_id ?? "", autopayFromName: p.autopay_from_name ?? "", expect: p.expect ?? "monthly" })),
    history, accounts, cfBalances,
    // Payment details are for finance only; the CPA can see and download what's filed, nothing more.
    credits: acc.role === "finance" ? credits : {},
    payAccounts: acc.role === "finance" ? payAccounts : [],
    lastCheck: acc.role === "finance" ? lastCheck : {},
  });
}
