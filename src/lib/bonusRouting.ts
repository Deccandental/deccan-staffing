import { supabase } from "./supabase";
import { Employee } from "@/types/employee";
import { isHygieneBonusEligible } from "./hygieneBonus";

/**
 * Sends bonus money paid through payroll to the bonus programme it belongs
 * to, so it only has to be entered once.
 *
 * Each programme stores payments differently — hygiene and Dr. Ho keep a
 * running "paid" figure on a period row, while growth and net-production
 * have their own payment tables — so this module hides those differences
 * behind one call.
 *
 * Which programme a payment belongs to is worked out from the employee's
 * eligibility flags. Where someone is eligible for more than one, the
 * caller is told rather than the app silently guessing: money landing in
 * the wrong programme is worse than asking.
 */

export type BonusProgramme = "hygiene" | "growth" | "pv" | "ho";

export const PROGRAMME_LABELS: Record<BonusProgramme, string> = {
  hygiene: "Hygiene Bonus",
  growth: "Growth Bonus",
  pv: "Net Production Bonus",
  ho: "Dr. Ho Bonus",
};

function isHygienist(emp: Employee): boolean {
  return isHygieneBonusEligible(emp);
}

/** Every programme this person could receive a bonus under. */
export function eligibleProgrammes(emp: Employee): BonusProgramme[] {
  const out: BonusProgramme[] = [];
  if (emp.hoBonusEligible) out.push("ho");
  if (emp.pvBonusEligible) out.push("pv");
  if (emp.growthBonusEligible) out.push("growth");
  if (isHygienist(emp)) out.push("hygiene");
  return out;
}

/**
 * The programme a payment should go to, or null when it can't be decided.
 * `ambiguous` means the person qualifies for several and someone needs to
 * choose; `none` means they're on no programme, so the payment is just pay.
 */
export function routeFor(emp: Employee): { programme: BonusProgramme | null; reason: "ok" | "none" | "ambiguous"; options: BonusProgramme[] } {
  const options = eligibleProgrammes(emp);
  if (options.length === 0) return { programme: null, reason: "none", options };
  if (options.length > 1) return { programme: null, reason: "ambiguous", options };
  return { programme: options[0], reason: "ok", options };
}

function quarterOf(dateStr: string): 1 | 2 | 3 | 4 {
  const m = Number(dateStr.slice(5, 7));
  return (m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4) as 1 | 2 | 3 | 4;
}

/**
 * Records (or updates, or clears) a bonus payment against a programme.
 *
 * Passing amount 0 removes a previously linked payment, so clearing the
 * Bonus $ box on a payroll row doesn't leave a stale payment behind in the
 * programme — the two stay in step in both directions.
 */
export async function recordBonusPayment(opts: {
  programme: BonusProgramme;
  employeeId: number;
  amount: number;
  paidDate: string;        // the date the money is paid — a pay period end, or an off-cycle date
  payPeriodStart?: string; // hygiene is keyed by pay period, so it needs both
  payPeriodEnd?: string;
  sourceKey: string;
  notes?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { programme, employeeId, amount, paidDate, sourceKey, notes = "" } = opts;

  try {
    if (programme === "growth" || programme === "pv") {
      const table = programme === "growth" ? "growth_bonus_payments" : "pv_bonus_payments";
      if (amount <= 0) {
        await supabase.from(table).delete().eq("source_key", sourceKey);
        return { ok: true };
      }
      const payload: Record<string, unknown> = {
        employee_id: employeeId, amount, notes, source_key: sourceKey,
      };
      if (programme === "growth") {
        payload.date = paidDate;
      } else {
        payload.date_paid = paidDate;
        payload.year = Number(paidDate.slice(0, 4));
        payload.quarter = quarterOf(paidDate);
      }
      const { error } = await supabase.from(table).upsert(payload, { onConflict: "source_key" });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    }

    if (programme === "hygiene") {
      // Hygiene is stored per pay period, which lines up with payroll
      // exactly. An off-cycle payment has no period, so it falls back to
      // treating the payment date as a single-day period.
      const start = opts.payPeriodStart ?? paidDate;
      const end = opts.payPeriodEnd ?? paidDate;
      const { error } = await supabase.from("hygiene_bonus_entries").upsert({
        employee_id: employeeId, pay_period_start: start, pay_period_end: end,
        amount_paid: amount, updated_at: new Date().toISOString(),
      }, { onConflict: "employee_id,pay_period_start" });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    }

    // Dr. Ho is paid two or three times in some months, so payments are
    // recorded individually with their own dates rather than written into a
    // single monthly figure — writing the month would overwrite whatever
    // was paid earlier in it.
    if (amount <= 0) {
      await supabase.from("ho_bonus_payments").delete().eq("source_key", sourceKey);
      return { ok: true };
    }
    const { error } = await supabase.from("ho_bonus_payments").upsert({
      employee_id: employeeId, date_paid: paidDate, amount, notes, source_key: sourceKey,
    }, { onConflict: "source_key" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err: any) {
    console.error("recordBonusPayment error:", err);
    return { ok: false, error: err?.message ?? "Failed to record bonus payment." };
  }
}

// ---------------- Off-cycle payments ----------------

export interface OffCyclePayment {
  id: string;
  employeeId: number;
  paidDate: string;
  amount: number;
  programme: BonusProgramme | "none";
  notes: string;
  createdAt: string;
}

function fromRow(row: any): OffCyclePayment {
  return {
    id: row.id, employeeId: row.employee_id, paidDate: row.paid_date,
    amount: row.amount ?? 0, programme: row.programme ?? "none",
    notes: row.notes ?? "", createdAt: row.created_at,
  };
}

export async function loadOffCyclePayments(startDate?: string, endDate?: string): Promise<OffCyclePayment[]> {
  let query = supabase.from("off_cycle_payments").select("*");
  if (startDate) query = query.gte("paid_date", startDate);
  if (endDate) query = query.lte("paid_date", endDate);
  const { data, error } = await query.order("paid_date", { ascending: false });
  if (error) { console.error("loadOffCyclePayments error:", error); return []; }
  return (data ?? []).map(fromRow);
}

export async function addOffCyclePayment(opts: {
  employeeId: number; paidDate: string; amount: number;
  programme: BonusProgramme | "none"; notes?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.from("off_cycle_payments").insert({
    employee_id: opts.employeeId, paid_date: opts.paidDate, amount: opts.amount,
    programme: opts.programme, notes: opts.notes ?? "",
  }).select().single();
  if (error) { console.error("addOffCyclePayment error:", error); return { ok: false, error: error.message }; }

  // A payment tagged to a programme is also recorded there, so the
  // programme's own balance reflects it.
  if (opts.programme !== "none" && opts.amount > 0) {
    const linked = await recordBonusPayment({
      programme: opts.programme,
      employeeId: opts.employeeId,
      amount: opts.amount,
      paidDate: opts.paidDate,
      sourceKey: `offcycle:${data.id}`,
      notes: opts.notes ?? "Off-cycle payment",
    });
    if (!linked.ok) return { ok: false, error: `Payment saved, but linking to ${PROGRAMME_LABELS[opts.programme]} failed: ${linked.error}` };
  }
  return { ok: true };
}

export async function deleteOffCyclePayment(id: string, programme: BonusProgramme | "none"): Promise<void> {
  if (programme !== "none") {
    await recordBonusPayment({
      programme, employeeId: 0, amount: 0, paidDate: new Date().toISOString().slice(0, 10),
      sourceKey: `offcycle:${id}`,
    });
  }
  const { error } = await supabase.from("off_cycle_payments").delete().eq("id", id);
  if (error) console.error("deleteOffCyclePayment error:", error);
}
