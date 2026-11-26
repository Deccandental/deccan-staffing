import { NextRequest, NextResponse } from "next/server";
import { sessionFrom, hasPerm } from "@/lib/routeAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { todayStr } from "@/lib/today";
import { ensureCharges, setCharge } from "@/lib/charge";
import { buildDayPlans, monthEnd, displayNameFor } from "@/lib/openDental/dayPlan";

// The charge assistant rota, for the Schedule Builder.
//   { action: "day", date }                 who's in charge that day, who could be, and each one's last turn
//   { action: "month", date }               who's in charge on each day of date's month
//   { action: "set", date, employeeId }     pick someone by hand (admins); employeeId null = back to automatic
export const runtime = "nodejs";
export const maxDuration = 60;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  const session = sessionFrom(req);
  if (!session) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  if (!hasPerm(session, "admin") && !hasPerm(session, "leaveManage")) return NextResponse.json({ ok: false, error: "Not permitted." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const date = String(body?.date ?? "");
  if (!YMD.test(date)) return NextResponse.json({ ok: false, error: "Bad date." }, { status: 400 });
  const action = String(body?.action ?? "day");

  try {
    if (action === "set") {
      if (!hasPerm(session, "admin")) return NextResponse.json({ ok: false, error: "Only an admin can change the charge assistant." }, { status: 403 });
      if (date < todayStr()) return NextResponse.json({ ok: false, error: "Past days can't be changed." }, { status: 400 });
      const id = body?.employeeId == null ? null : Number(body.employeeId);
      if (id != null && !Number.isInteger(id)) return NextResponse.json({ ok: false, error: "Bad person." }, { status: 400 });
      if (id != null) {
        const { plans } = await buildDayPlans(date, date);
        if (!plans[0]?.chargeCandidates.includes(id)) return NextResponse.json({ ok: false, error: "They aren't assisting that day." }, { status: 400 });
      }
      await setCharge(date, id, monthEnd(date) > date ? monthEnd(date) : date);
    }

    if (action === "month") {
      const end = monthEnd(date);
      await ensureCharges(end).catch(() => undefined);
      const [{ data }, { data: staff }] = await Promise.all([
        supabaseAdmin.from("charge_assignments").select("date, employee_id, manual").gte("date", `${date.slice(0, 7)}-01`).lte("date", end),
        supabaseAdmin.from("staff").select("id, name"),
      ]);
      const nameOf = new Map((staff ?? []).map((s: any) => [s.id, s.name]));
      const days: Record<string, { employeeId: number; name: string; manual: boolean }> = {};
      for (const r of data ?? []) days[r.date] = { employeeId: r.employee_id, name: nameOf.get(r.employee_id) ?? "?", manual: !!r.manual };
      return NextResponse.json({ ok: true, days });
    }

    // "day" (also the answer after "set")
    await ensureCharges(date).catch(() => undefined);
    const [{ plans, staff, links }, { data: rec }, { data: hist }] = await Promise.all([
      buildDayPlans(date, date),
      supabaseAdmin.from("charge_assignments").select("employee_id, manual").eq("date", date).maybeSingle(),
      supabaseAdmin.from("charge_assignments").select("date, employee_id").lt("date", date).order("date", { ascending: false }).limit(400),
    ]);
    const plan = plans[0];
    const lastTurn = new Map<number, string>();
    const turns90 = new Map<number, number>();
    const since = new Date(Date.parse(`${date}T12:00:00Z`) - 90 * 86400000).toISOString().slice(0, 10);
    for (const h of hist ?? []) {
      if (!lastTurn.has(h.employee_id)) lastTurn.set(h.employee_id, h.date);
      if (h.date >= since) turns90.set(h.employee_id, (turns90.get(h.employee_id) ?? 0) + 1);
    }
    const person = (id: number) => {
      const e = staff.find((s) => s.id === id);
      return { employeeId: id, name: e?.name ?? "?", shownAs: e ? displayNameFor(e, links) : "?", lastTurn: lastTurn.get(id) ?? null, turns90: turns90.get(id) ?? 0 };
    };
    const current = rec && plan?.chargeCandidates.includes(rec.employee_id) ? { ...person(rec.employee_id), manual: !!rec.manual } : null;
    return NextResponse.json({
      ok: true,
      date,
      editable: date >= todayStr(),
      current,
      candidates: (plan?.chargeCandidates ?? []).map(person).sort((a, b) => (a.lastTurn ?? "").localeCompare(b.lastTurn ?? "")),
    });
  } catch (e: any) {
    console.error("charge route failed:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Something went wrong." }, { status: 500 });
  }
}
