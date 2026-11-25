import { secureData as supabase } from "./secureData";
import { requestOdSync } from "./openDental/clientSync";

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
  // One-off note for what the Floater does that day ("help Jansten too"),
  // shown on the Staff Schedules blockout in Open Dental.
  floaterNote?: string;
  // Front desk seat index -> who sits there, when picked by hand.
  frontDeskOverrides?: Record<number, number>;
  // People doing admin that day (working, but not front desk or assisting).
  adminIds?: number[];
};
export type MonthSchedule = Record<string, DaySchedule>;

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export async function loadSchedule(year: number, month: number): Promise<MonthSchedule> {
  return (await loadScheduleOrNull(year, month)) ?? {};
}

// Like loadSchedule, but returns null when the load FAILED, so a caller can
// tell "nothing saved yet" apart from "couldn't read it". The Schedule Builder
// fills empty days with defaults, and must never do that after a failed load.
export async function loadScheduleOrNull(year: number, month: number): Promise<MonthSchedule | null> {
  const key = monthKey(year, month);
  const cols = "date, dentists, front_desk_required, hygienists_required, assistant_overrides, hygienist_overrides, assistant_counts, floater_assistant_id";
  let { data, error } = await supabase.from("schedules").select(`${cols}, floater_note, front_desk_overrides, admin_ids`).like("date", `${key}-%`);
  // If newer columns haven't been added to the database yet, load without them.
  if (error) ({ data, error } = await supabase.from("schedules").select(`${cols}, floater_note`).like("date", `${key}-%`));
  if (error) ({ data, error } = await supabase.from("schedules").select(cols).like("date", `${key}-%`));
  if (error) { console.error("loadSchedule error:", error); return null; }
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
      floaterNote: (row as any).floater_note ?? "",
      frontDeskOverrides: (row as any).front_desk_overrides ?? {},
      adminIds: (row as any).admin_ids ?? [],
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
  else requestOdSync(date);
}

// Saves a day's defaults only if nothing is saved for that date yet — an
// existing row is left exactly as it is.
export async function saveDefaultDayIfMissing(date: string, dentists: string[], frontDeskRequired = 2, hygienistsRequired = 1): Promise<void> {
  const { error } = await supabase.from("schedules").upsert(
    {
      date, dentists, front_desk_required: frontDeskRequired, hygienists_required: hygienistsRequired,
      assistant_overrides: {}, hygienist_overrides: {}, assistant_counts: {}, floater_assistant_id: null,
    },
    { onConflict: "date", ignoreDuplicates: true }
  );
  if (error) console.error("saveDefaultDayIfMissing error:", error);
}

// Saves only who's on the front desk and who's doing admin for the day.
export async function saveFrontDeskPlan(date: string, frontDeskOverrides: Record<number, number>, adminIds: number[]): Promise<boolean> {
  const { error } = await supabase.from("schedules").update({
    front_desk_overrides: frontDeskOverrides, admin_ids: adminIds,
  }).eq("date", date);
  if (error) { console.error("saveFrontDeskPlan error:", error); return false; }
  requestOdSync(date);
  return true;
}

// Saves only the day's floater note, leaving the rest of the day as it is.
export async function saveFloaterNote(date: string, note: string): Promise<boolean> {
  const { error } = await supabase.from("schedules").update({ floater_note: note.trim() || null }).eq("date", date);
  if (error) { console.error("saveFloaterNote error:", error); return false; }
  requestOdSync(date);
  return true;
}

export async function deleteDaySchedule(date: string): Promise<void> {
  const { error } = await supabase.from("schedules").delete().eq("date", date);
  if (error) console.error("deleteDaySchedule error:", error);
  else requestOdSync(date);
}
