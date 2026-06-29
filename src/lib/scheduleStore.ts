import { supabase } from "./supabase";

export type DaySchedule = { dentists: string[] };
export type MonthSchedule = Record<string, DaySchedule>;

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export async function loadSchedule(year: number, month: number): Promise<MonthSchedule> {
  const key = monthKey(year, month);
  const { data, error } = await supabase
    .from("schedules")
    .select("date, dentists")
    .like("date", `${key}-%`);
  if (error) { console.error("loadSchedule error:", error); return {}; }
  const schedule: MonthSchedule = {};
  for (const row of data ?? []) {
    schedule[row.date] = { dentists: row.dentists ?? [] };
  }
  return schedule;
}

export async function saveDaySchedule(date: string, dentists: string[]): Promise<void> {
  const { error } = await supabase.from("schedules").upsert(
    { date, dentists },
    { onConflict: "date" }
  );
  if (error) console.error("saveDaySchedule error:", error);
}

export async function deleteDaySchedule(date: string): Promise<void> {
  const { error } = await supabase.from("schedules").delete().eq("date", date);
  if (error) console.error("deleteDaySchedule error:", error);
}
