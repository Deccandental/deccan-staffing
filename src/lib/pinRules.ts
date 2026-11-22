// Server-only rules for a staff PIN: exactly 6 digits, not trivially
// guessable, and not already used by anyone else (the login matches people by
// PIN alone, so two people can't share one).
import { supabaseAdmin } from "./supabaseAdmin";

export const PIN_LENGTH = 6;
export const PIN_TAKEN = "That PIN isn't available. Please pick another.";

const WEAK = new Set(["123456", "654321", "000000", "111111", "222222", "333333", "444444", "555555", "666666", "777777", "888888", "999999", "121212", "112233"]);

export async function pinProblem(pin: string, employeeId: number | null): Promise<string | null> {
  if (!/^\d{6}$/.test(pin)) return `A PIN must be exactly ${PIN_LENGTH} digits.`;
  if (WEAK.has(pin)) return "That PIN is too easy to guess. Please pick another.";
  if (pin === process.env.SUPER_PASSCODE || pin === process.env.CPA_PASSCODE) return "That PIN isn't available. Please pick another.";
  let q = supabaseAdmin.from("staff").select("id").eq("pin", pin).limit(1);
  if (employeeId != null) q = q.neq("id", employeeId);
  const { data, error } = await q;
  if (error) return "Couldn't check the PIN. Please try again.";
  if (data && data.length > 0) return PIN_TAKEN;
  return null;
}
