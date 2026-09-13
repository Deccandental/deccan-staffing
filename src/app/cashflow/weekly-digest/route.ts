import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendWeeklyCashDigest } from "@/lib/cashflowEmail";

const STALE_DAYS = 7;

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

  const items: string[] = [];
  const now = Date.now();

  const { data: accounts } = await supabase.from("cash_accounts").select("*");
  const { data: cards } = await supabase.from("credit_cards").select("*");
  const { data: balanceRows } = await supabase.from("balance_checks").select("*").order("checked_at", { ascending: false });

  const latestByAccount = new Map<string, string>();
  for (const row of balanceRows ?? []) {
    if (!latestByAccount.has(row.account_name)) latestByAccount.set(row.account_name, row.checked_at);
  }

  for (const acct of accounts ?? []) {
    const lastChecked = latestByAccount.get(acct.name);
    const daysSince = lastChecked ? (now - new Date(lastChecked).getTime()) / 86400000 : Infinity;
    if (daysSince >= STALE_DAYS) items.push(`<strong>${acct.name}</strong> bank balance hasn't been updated in ${lastChecked ? Math.floor(daysSince) + " days" : "a while"}.`);
  }

  for (const card of cards ?? []) {
    const lastChecked = latestByAccount.get(card.name);
    const daysSince = lastChecked ? (now - new Date(lastChecked).getTime()) / 86400000 : Infinity;
    if (daysSince >= STALE_DAYS) items.push(`<strong>${card.name}</strong> current balance hasn't been updated in ${lastChecked ? Math.floor(daysSince) + " days" : "a while"}.`);

    const stmtDaysSince = card.statement_balance_updated_at ? (now - new Date(card.statement_balance_updated_at).getTime()) / 86400000 : Infinity;
    if (stmtDaysSince >= STALE_DAYS) items.push(`<strong>${card.name}</strong> statement balance hasn't been updated in ${card.statement_balance_updated_at ? Math.floor(stmtDaysSince) + " days" : "a while"}.`);
  }

  const { data: latestReview } = await supabase.from("weekly_cash_reviews").select("*").order("review_date", { ascending: false }).limit(1).maybeSingle();
  const reviewDaysSince = latestReview ? (now - new Date(latestReview.review_date).getTime()) / 86400000 : Infinity;
  if (reviewDaysSince >= STALE_DAYS) items.push("This week's Open Dental MTD Production/Income numbers haven't been entered yet.");

  const sent = await sendWeeklyCashDigest(items);
  return NextResponse.json({ ok: true, itemCount: items.length, sent });
}
