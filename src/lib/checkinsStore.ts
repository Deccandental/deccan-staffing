import { supabase } from "./supabase";

export interface CheckinSlot {
  id: string;
  date: string;
  time: string;
  claimedByEmployeeId: number | null;
  claimedByName: string | null;
  completed: boolean;
  notes: string;
  createdAt: string;
}

function fromRow(row: any): CheckinSlot {
  return {
    id: row.id, date: row.date, time: row.time,
    claimedByEmployeeId: row.claimed_by_employee_id, claimedByName: row.claimed_by_name,
    completed: row.completed, notes: row.notes ?? "", createdAt: row.created_at,
  };
}

export async function loadAllSlots(): Promise<CheckinSlot[]> {
  const { data, error } = await supabase.from("checkin_slots").select("*").order("date", { ascending: true });
  if (error) { console.error("loadAllSlots error:", error); return []; }
  return (data ?? []).map(fromRow);
}

export async function createSlot(date: string, time: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("checkin_slots").insert({ date, time });
  if (error) { console.error("createSlot error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

// Records a check-in that already happened — an impromptu one, or any
// conversation held without booking a slot first. Creating a slot and then
// claiming it doesn't work for past dates, because open slots are only
// listed from today onwards, so a past slot is never claimable. This
// writes the finished record in one step instead.
export async function logPastCheckin(
  date: string, time: string, employeeId: number, employeeName: string, notes: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("checkin_slots").insert({
    date, time,
    claimed_by_employee_id: employeeId,
    claimed_by_name: employeeName,
    notes,
    completed: true,
  });
  if (error) { console.error("logPastCheckin error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function claimSlot(slotId: string, employeeId: number, employeeName: string, notes: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("checkin_slots")
    .update({ claimed_by_employee_id: employeeId, claimed_by_name: employeeName, notes })
    .eq("id", slotId).is("claimed_by_employee_id", null); // only claim if still open
  if (error) { console.error("claimSlot error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function unclaimSlot(slotId: string): Promise<void> {
  const { error } = await supabase.from("checkin_slots")
    .update({ claimed_by_employee_id: null, claimed_by_name: null, completed: false })
    .eq("id", slotId);
  if (error) console.error("unclaimSlot error:", error);
}

export async function markSlotCompleted(slotId: string, completed: boolean): Promise<void> {
  const { error } = await supabase.from("checkin_slots").update({ completed }).eq("id", slotId);
  if (error) console.error("markSlotCompleted error:", error);
}

export async function updateSlotNotes(slotId: string, notes: string): Promise<void> {
  const { error } = await supabase.from("checkin_slots").update({ notes }).eq("id", slotId);
  if (error) console.error("updateSlotNotes error:", error);
}

export async function updateSlotDateTime(slotId: string, date: string, time: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("checkin_slots").update({ date, time }).eq("id", slotId);
  if (error) { console.error("updateSlotDateTime error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function deleteSlot(slotId: string): Promise<void> {
  const { error } = await supabase.from("checkin_slots").delete().eq("id", slotId);
  if (error) console.error("deleteSlot error:", error);
}

// ---------------- Due-status computation ----------------

export interface CheckinStatus {
  lastCompletedDate: string | null; // most recent completed slot's date, or null if never
  nextDueDate: string | null; // lastCompletedDate + 6 months, or null if never had one (due now)
  isDue: boolean; // true if never completed one, or 6+ months since the last one
  upcomingSlot: CheckinSlot | null; // a claimed-but-not-yet-completed future slot, if any
}

function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1 + months, d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function computeCheckinStatus(employeeId: number, allSlots: CheckinSlot[], today: string): CheckinStatus {
  const mine = allSlots.filter((s) => s.claimedByEmployeeId === employeeId);
  const completed = mine.filter((s) => s.completed).sort((a, b) => b.date.localeCompare(a.date));
  const lastCompletedDate = completed.length > 0 ? completed[0].date : null;
  const nextDueDate = lastCompletedDate ? addMonths(lastCompletedDate, 6) : null;
  const isDue = !lastCompletedDate || today >= nextDueDate!;
  const upcomingSlot = mine.find((s) => !s.completed && s.date >= today) ?? null;
  return { lastCompletedDate, nextDueDate, isDue, upcomingSlot };
}
