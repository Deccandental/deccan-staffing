import { secureData as supabase } from "./secureData"; // financial data goes through the secure server gateway, not the public key

/**
 * An unpaid bonus balance carried in from before the app's own records begin.
 * It is a single dollar figure per programme (and per person where the
 * programme is per person), typed in by hand: no calculation. From the start
 * of `asOfYear` onward the app calculates everything itself.
 *
 * employeeId is 0 for programmes that aren't per person (staff growth bonus).
 */

export type CarryProgramme = "hygiene" | "growth" | "pv" | "retirement";

export interface BonusCarryover {
  programme: CarryProgramme;
  employeeId: number;
  amount: number;
  asOfYear: number; // the balance is what was unpaid at the start of this year
}

export const carryKey = (programme: CarryProgramme, employeeId: number) => `${programme}:${employeeId}`;

export async function loadBonusCarryovers(): Promise<Map<string, BonusCarryover>> {
  const { data, error } = await supabase.from("bonus_carryover").select("*");
  const map = new Map<string, BonusCarryover>();
  if (error) { console.error("loadBonusCarryovers error:", error); return map; }
  for (const r of data ?? []) {
    map.set(carryKey(r.programme, r.employee_id), { programme: r.programme, employeeId: r.employee_id, amount: r.amount ?? 0, asOfYear: r.as_of_year });
  }
  return map;
}

export async function saveBonusCarryover(c: BonusCarryover): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("bonus_carryover").upsert({
    programme: c.programme, employee_id: c.employeeId, amount: c.amount, as_of_year: c.asOfYear, updated_at: new Date().toISOString(),
  }, { onConflict: "programme,employee_id" });
  if (error) { console.error("saveBonusCarryover error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}
