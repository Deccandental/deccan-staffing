import { supabase } from "./supabase";

/**
 * A running log of notes about each staff member.
 *
 * Every entry carries two separate notes. The shared one is what was
 * discussed and the person can read it on their own dashboard; the private
 * one is for managers only. Keeping both on the same entry means a frank
 * record and the version actually said out loud stay together, instead of
 * being split across two systems that drift apart.
 */

export type StaffNoteKind = "checkin" | "extra" | "review" | "incident" | "general";

// A scheduled check-in is one of the regular cycle (currently every six
// months); an additional one is an extra conversation in between. Lumping
// them together made a casual catch-up read later as a formal review.
export const NOTE_KIND_LABELS: Record<StaffNoteKind, string> = {
  checkin: "Scheduled check-in",
  extra: "Additional check-in",
  review: "Annual review",
  incident: "Incident review",
  general: "General note",
};

export interface StaffNote {
  id: string;
  employeeId: number;
  noteDate: string;
  kind: StaffNoteKind;
  sharedNote: string;
  privateNote: string;
  followUpDate: string | null;
  followUpDone: boolean;
  checkinSlotId: string | null;
  recordedBy: string;
  createdAt: string;
}

function fromRow(row: any): StaffNote {
  return {
    id: row.id,
    employeeId: row.employee_id,
    noteDate: row.note_date,
    kind: (row.kind ?? "general") as StaffNoteKind,
    sharedNote: row.shared_note ?? "",
    privateNote: row.private_note ?? "",
    followUpDate: row.follow_up_date ?? null,
    followUpDone: row.follow_up_done ?? false,
    checkinSlotId: row.checkin_slot_id ?? null,
    recordedBy: row.recorded_by ?? "",
    createdAt: row.created_at,
  };
}

/**
 * Shared notes only, for showing someone their own history.
 *
 * Deliberately selects an explicit column list rather than "*": filtering
 * the private note out in the UI would still have sent it to the browser,
 * where anyone could read it in dev tools. It never leaves the database.
 */
export async function loadSharedStaffNotes(employeeId: number): Promise<StaffNote[]> {
  const { data, error } = await supabase.from("staff_notes")
    .select("id, employee_id, note_date, kind, shared_note, follow_up_date, follow_up_done, checkin_slot_id, recorded_by, created_at")
    .eq("employee_id", employeeId)
    .neq("shared_note", "")
    .order("note_date", { ascending: false });
  if (error) { console.error("loadSharedStaffNotes error:", error); return []; }
  return (data ?? []).map((row) => ({ ...fromRow(row), privateNote: "" }));
}

/** Full notes including the private half — managers only. */
export async function loadStaffNotes(employeeId?: number): Promise<StaffNote[]> {
  let query = supabase.from("staff_notes").select("*").order("note_date", { ascending: false });
  if (employeeId != null) query = query.eq("employee_id", employeeId);
  const { data, error } = await query;
  if (error) { console.error("loadStaffNotes error:", error); return []; }
  return (data ?? []).map(fromRow);
}

export interface StaffNoteInput {
  employeeId: number;
  noteDate: string;
  kind: StaffNoteKind;
  sharedNote: string;
  privateNote: string;
  followUpDate?: string | null;
  checkinSlotId?: string | null;
  recordedBy: string;
}

export async function addStaffNote(input: StaffNoteInput): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("staff_notes").insert({
    employee_id: input.employeeId,
    note_date: input.noteDate,
    kind: input.kind,
    shared_note: input.sharedNote,
    private_note: input.privateNote,
    follow_up_date: input.followUpDate || null,
    checkin_slot_id: input.checkinSlotId || null,
    recorded_by: input.recordedBy,
  });
  if (error) { console.error("addStaffNote error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function updateStaffNote(
  id: string,
  updates: { noteDate: string; kind: StaffNoteKind; sharedNote: string; privateNote: string; followUpDate: string | null }
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("staff_notes").update({
    note_date: updates.noteDate,
    kind: updates.kind,
    shared_note: updates.sharedNote,
    private_note: updates.privateNote,
    follow_up_date: updates.followUpDate || null,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) { console.error("updateStaffNote error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function setFollowUpDone(id: string, done: boolean): Promise<void> {
  const { error } = await supabase.from("staff_notes")
    .update({ follow_up_done: done, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) console.error("setFollowUpDone error:", error);
}

export async function deleteStaffNote(id: string): Promise<void> {
  const { error } = await supabase.from("staff_notes").delete().eq("id", id);
  if (error) console.error("deleteStaffNote error:", error);
}

/**
 * Follow-ups that are due or overdue — the point of recording a date is that
 * "let's revisit in a month" doesn't quietly evaporate.
 */
export function dueFollowUps(notes: StaffNote[], today: string): StaffNote[] {
  return notes
    .filter((n) => !n.followUpDone && n.followUpDate && n.followUpDate <= today)
    .sort((a, b) => (a.followUpDate ?? "").localeCompare(b.followUpDate ?? ""));
}
