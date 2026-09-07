import { supabase } from "./supabase";

// A dentist's assistant override value: either the legacy shape (a single
// assistant id, or null for "explicitly none" — slot 0 only), or the new
// nested shape (slot index -> assistant id | null) once a dentist has more
// than one assistant. Both shapes may appear in existing saved data.
export type AssistantOverrideValue = number | null | Record<number, number | null>;
export type AssistantOverrides = Record<number, AssistantOverrideValue>;

export type DaySchedule = {
  dentists: string[];
  frontDeskRequired?: number;
  hygienistsRequired?: number;
  assistantOverrides?: AssistantOverrides;
  // Keyed by hygienist "slot" index (0-based, up to hygienistsRequired - 1).
  // Absent/undefined means "use the auto-assigned default" for that slot —
  // this keeps the field fully backward compatible with existing saved rows.
  hygienistOverrides?: Record<number, number | null>;
  // Keyed by dentist id. Absent/undefined means "default to 1 assistant"
  // for that dentist — keeps this fully backward compatible with existing
  // saved rows that predate this field.
  assistantCounts?: Record<number, number>;
  // The day's Floater: one extra assistant added for the day as a whole,
  // not tied to any specific dentist. Absent/undefined or null means no
  // Floater is assigned that day. Purely additive on top of the per-dentist
  // assistantCounts/assistantOverrides mechanism above.
  floaterAssistantId?: number | null;
};
export type MonthSchedule = Record<string, DaySchedule>;

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export async function loadSchedule(year: number, month: number): Promise<MonthSchedule> {
  const key = monthKey(year, month);
  const { data, error } = await supabase
    .from("schedules")
    .select("date, dentists, front_desk_required, hygienists_required, assistant_overrides, hygienist_overrides, assistant_counts, floater_assistant_id")
    .like("date", `${key}-%`);
  if (error) { console.error("loadSchedule error:", error); return {}; }
  const schedule: MonthSchedule = {};
  for (const row of data ?? []) {
    schedule[row.date] = {
      dentists: row.dentists ?? [],
      frontDeskRequired: row.front_desk_required ?? 2,
      hygienistsRequired: row.hygienists_required ?? 1,
      assistantOverrides: row.assistant_overrides ?? {},
      hygienistOverrides: row.hygienist_overrides ?? {},
      assistantCounts: row.assistant_counts ?? {},
      floaterAssistantId: row.floater_assistant_id ?? null,
    };
  }
  return schedule;
}

export async function saveDaySchedule(
  date: string,
  dentists: string[],
  frontDeskRequired: number = 2,
  hygienistsRequired: number = 1,
  assistantOverrides: AssistantOverrides = {},
  hygienistOverrides: Record<number, number | null> = {},
  assistantCounts: Record<number, number> = {},
  floaterAssistantId: number | null = null
): Promise<void> {
  const { error } = await supabase.from("schedules").upsert(
    {
      date, dentists, front_desk_required: frontDeskRequired, hygienists_required: hygienistsRequired,
      assistant_overrides: assistantOverrides, hygienist_overrides: hygienistOverrides,
      assistant_counts: assistantCounts, floater_assistant_id: floaterAssistantId,
    },
    { onConflict: "date" }
  );
  if (error) console.error("saveDaySchedule error:", error);
}

export async function deleteDaySchedule(date: string): Promise<void> {
  const { error } = await supabase.from("schedules").delete().eq("date", date);
  if (error) console.error("deleteDaySchedule error:", error);
}
