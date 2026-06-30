import { supabase } from "./supabase";

export type DaySchedule = { dentists: string[]; frontDeskRequired?: number; hygienistsRequired?: number };
export type MonthSchedule = Record<string, DaySchedule>;

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export async function loadSchedule(year: number, month: number): Promise<MonthSchedule> {
  const key = monthKey(year, month);
  const { data, error } = await supabase
    .from("schedules")
    .select("date, dentists, front_desk_required, hygienists_required")
    .like("date", `${key}-%`);
  if (error) { console.error("loadSchedule error:", error); return {}; }
  const schedule: MonthSchedule = {};
  for (const row of data ?? []) {
    schedule[row.date] = {
      dentists: row.dentists ?? [],
      frontDeskRequired: row.front_desk_required ?? 2,
      hygienistsRequired: row.hygienists_required ?? 1,
    };
  }
  return schedule;
}

export async function saveDaySchedule(
  date: string,
  dentists: string[],
  frontDeskRequired: number = 2,
  hygienistsRequired: number = 1
): Promise<void> {
  const { error } = await supabase.from("schedules").upsert(
    { date, dentists, front_desk_required: frontDeskRequired, hygienists_required: hygienistsRequired },
    { onConflict: "date" }
  );
  if (error) console.error("saveDaySchedule error:", error);
}

export async function deleteDaySchedule(date: string): Promise<void> {
  const { error } = await supabase.from("schedules").delete().eq("date", date);
  if (error) console.error("deleteDaySchedule error:", error);
}
