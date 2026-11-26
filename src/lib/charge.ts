// Server-only: the charge assistant for each day, rotating fairly.
//
// Each open day one assistant on the plan (with a dentist, or floating) is
// in charge. Who:
//   1. only assistants working that day (not on full-day leave);
//   2. not someone away for half the day, unless there's no one else;
//   3. not whoever was in charge on the previous open day, unless they're the
//      only assistant in;
//   4. of the rest, whoever has gone longest since their last turn (someone
//      who has never had a turn goes first), then fewest turns, so everyone
//      takes turns in sequence.
// A day, once decided, keeps its charge assistant as long as that person is
// still working that day, so the rota doesn't reshuffle when later days
// change. An admin can pick someone by hand (manual), which is kept too.
// Past days are never changed; they're the history the rotation works from.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { todayStr } from "@/lib/today";
import { buildDayPlans, DayPlan } from "@/lib/openDental/dayPlan";

export interface ChargeRow { date: string; employee_id: number; manual: boolean }

/** The fair pick for one day (pure, so it can be tested on its own). */
export function pickCharge(
  candidates: number[],
  lastTurn: Map<number, string>,
  turns: Map<number, number>,
  previous: number | null,
  halfOff: Set<number> = new Set()
): number | null {
  if (candidates.length === 0) return null;
  let pool = candidates;
  const fullDay = pool.filter((id) => !halfOff.has(id));
  if (fullDay.length > 0) pool = fullDay;
  const notAgain = pool.filter((id) => id !== previous);
  if (notAgain.length > 0) pool = notAgain;
  return [...pool].sort((a, b) =>
    (lastTurn.get(a) ?? "").localeCompare(lastTurn.get(b) ?? "") ||
    (turns.get(a) ?? 0) - (turns.get(b) ?? 0) ||
    a - b
  )[0];
}

/** Walks the days in order and decides each one. Pure: returns the rows to keep. */
export function planCharges(plans: DayPlan[], history: ChargeRow[], stored: Map<string, ChargeRow>): ChargeRow[] {
  const lastTurn = new Map<number, string>();
  const turns = new Map<number, number>();
  let previous: number | null = null;
  for (const h of [...history].sort((a, b) => a.date.localeCompare(b.date))) {
    lastTurn.set(h.employee_id, h.date);
    turns.set(h.employee_id, (turns.get(h.employee_id) ?? 0) + 1);
    previous = h.employee_id;
  }
  const out: ChargeRow[] = [];
  for (const p of [...plans].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!p.isOpen || p.chargeCandidates.length === 0) continue;
    const rec = stored.get(p.date);
    const stillIn = rec && p.chargeCandidates.includes(rec.employee_id);
    const keep = stillIn && (rec!.manual || rec!.employee_id !== previous || p.chargeCandidates.length === 1);
    const id = keep ? rec!.employee_id : pickCharge(p.chargeCandidates, lastTurn, turns, previous, new Set(p.halfOffIds));
    if (id == null) continue;
    out.push({ date: p.date, employee_id: id, manual: keep ? !!rec!.manual : false });
    lastTurn.set(id, p.date);
    turns.set(id, (turns.get(id) ?? 0) + 1);
    previous = id;
  }
  return out;
}

/**
 * Makes sure every open day from today through `to` has its charge assistant
 * decided and saved. Returns the decided rows.
 */
export async function ensureCharges(to: string): Promise<ChargeRow[]> {
  const today = todayStr();
  if (to < today) return [];
  const [{ plans }, { data: hist, error: e1 }, { data: cur, error: e2 }] = await Promise.all([
    buildDayPlans(today, to),
    supabaseAdmin.from("charge_assignments").select("date, employee_id, manual").lt("date", today).order("date"),
    supabaseAdmin.from("charge_assignments").select("date, employee_id, manual").gte("date", today).lte("date", to),
  ]);
  if (e1 || e2) throw new Error(`Couldn't read the charge rota: ${(e1 ?? e2)!.message}`);
  const stored = new Map<string, ChargeRow>((cur ?? []).map((r: any) => [r.date, r]));
  const rows = planCharges(plans, hist ?? [], stored);

  const changed = rows.filter((r) => {
    const s = stored.get(r.date);
    return !s || s.employee_id !== r.employee_id || !!s.manual !== r.manual;
  });
  const gone = [...stored.keys()].filter((d) => !rows.some((r) => r.date === d));
  if (changed.length > 0) {
    const { error } = await supabaseAdmin.from("charge_assignments")
      .upsert(changed.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: "date" });
    if (error) throw new Error(`Couldn't save the charge rota: ${error.message}`);
  }
  if (gone.length > 0) await supabaseAdmin.from("charge_assignments").delete().in("date", gone);
  return rows;
}

/** Picks someone by hand for a day (or clears the pick with null), then re-balances the days after it. */
export async function setCharge(date: string, employeeId: number | null, through: string): Promise<void> {
  if (employeeId == null) {
    await supabaseAdmin.from("charge_assignments").delete().eq("date", date);
  } else {
    const { error } = await supabaseAdmin.from("charge_assignments")
      .upsert({ date, employee_id: employeeId, manual: true, updated_at: new Date().toISOString() }, { onConflict: "date" });
    if (error) throw new Error(error.message);
  }
  await ensureCharges(through);
}
