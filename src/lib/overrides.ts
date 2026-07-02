import { supabase } from "./supabase";

export interface StaffOverride {
  employeeId: number;
  date: string;
  reason: "sick" | "pto" | "leave" | "other" | "remote";
  halfDay?: "AM" | "PM" | null;
}

export async function getOverrides(): Promise<StaffOverride[]> {
  const { data, error } = await supabase.from("overrides").select("*");
  if (error) { console.error("getOverrides error:", error); return []; }
  return (data ?? []).map((row) => ({
    employeeId: row.employee_id,
    date: row.date,
    reason: row.reason,
    halfDay: row.half_day ?? null,
  }));
}

export async function setUnavailable(employeeId: number, date: string, reason: StaffOverride["reason"], halfDay?: "AM" | "PM" | null): Promise<void> {
  const { error } = await supabase.from("overrides").upsert({
    employee_id: employeeId, date, reason, half_day: halfDay ?? null,
  }, { onConflict: "employee_id,date" });
  if (error) console.error("setUnavailable error:", error);
}

export async function clearUnavailable(employeeId: number, date: string): Promise<void> {
  const { error } = await supabase.from("overrides").delete().eq("employee_id", employeeId).eq("date", date);
  if (error) console.error("clearUnavailable error:", error);
}

export async function isUnavailable(employeeId: number, date: string): Promise<boolean> {
  const { data } = await supabase.from("overrides").select("half_day, reason").eq("employee_id", employeeId).eq("date", date).single();
  // Remote staff are still available
  return !!data && !data.half_day && data.reason !== "remote";
}

export async function getOverrideForDate(employeeId: number, date: string): Promise<StaffOverride | undefined> {
  const { data } = await supabase.from("overrides").select("*").eq("employee_id", employeeId).eq("date", date).single();
  if (!data) return undefined;
  return { employeeId: data.employee_id, date: data.date, reason: data.reason, halfDay: data.half_day ?? null };
}
