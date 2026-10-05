import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { statementsAccess, whoIs } from "@/lib/statementsAuth";

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
      return NextResponse.json({ role: acc.role, checks: data ?? [] });
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
        created_by: whoIs(acc.session),
      }).select("*").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data });
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
