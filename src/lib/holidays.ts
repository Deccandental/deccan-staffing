import { supabase } from "./supabase";

export interface Holiday {
  date: string;
  name: string;
  type: "holiday" | "closure" | "other";
}

export async function loadHolidays(): Promise<Holiday[]> {
  const { data, error } = await supabase.from("holidays").select("*").order("date");
  if (error) { console.error("loadHolidays error:", error); return []; }
  return (data ?? []).map((row) => ({ date: row.date, name: row.name, type: row.type }));
}

export async function addHoliday(holiday: Holiday): Promise<void> {
  const { error } = await supabase.from("holidays").upsert({ date: holiday.date, name: holiday.name, type: holiday.type });
  if (error) console.error("addHoliday error:", error);
}

export async function removeHoliday(date: string): Promise<void> {
  const { error } = await supabase.from("holidays").delete().eq("date", date);
  if (error) console.error("removeHoliday error:", error);
}

export async function isHoliday(date: string): Promise<boolean> {
  const { data } = await supabase.from("holidays").select("date").eq("date", date).single();
  return !!data;
}
