import { supabase } from "./supabase";

export interface OpenTuesday {
  date: string;
  halfDay: "AM" | "PM" | null;
}

export async function getOpenTuesdays(): Promise<OpenTuesday[]> {
  const { data, error } = await supabase.from("open_tuesdays").select("*");
  if (error) { console.error("getOpenTuesdays error:", error); return []; }
  return (data ?? []).map((row) => ({ date: row.date, halfDay: row.half_day ?? null }));
}

export async function addOpenTuesday(date: string, halfDay: "AM" | "PM" | null): Promise<void> {
  const { error } = await supabase.from("open_tuesdays").upsert({ date, half_day: halfDay });
  if (error) console.error("addOpenTuesday error:", error);
}

export async function removeOpenTuesday(date: string): Promise<void> {
  const { error } = await supabase.from("open_tuesdays").delete().eq("date", date);
  if (error) console.error("removeOpenTuesday error:", error);
}
