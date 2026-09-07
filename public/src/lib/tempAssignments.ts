import { supabase } from "./supabase";

export interface TempAssignment {
  id: string;
  date: string;
  tempId: string;
  role: string;
  notes: string;
}

export async function getTempAssignments(date: string): Promise<TempAssignment[]> {
  const { data, error } = await supabase.from("temp_assignments").select("*").eq("date", date);
  if (error) { console.error("getTempAssignments error:", error); return []; }
  return (data ?? []).map((row) => ({
    id: row.id, date: row.date, tempId: row.temp_id, role: row.role, notes: row.notes,
  }));
}

export async function getTempAssignmentsForMonth(year: number, month: number): Promise<TempAssignment[]> {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const { data, error } = await supabase.from("temp_assignments").select("*").like("date", `${key}-%`);
  if (error) { console.error("getTempAssignmentsForMonth error:", error); return []; }
  return (data ?? []).map((row) => ({
    id: row.id, date: row.date, tempId: row.temp_id, role: row.role, notes: row.notes,
  }));
}

export async function addTempAssignment(assignment: Omit<TempAssignment, "id">): Promise<void> {
  const id = `ta-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error } = await supabase.from("temp_assignments").insert({
    id, date: assignment.date, temp_id: assignment.tempId, role: assignment.role, notes: assignment.notes,
  });
  if (error) console.error("addTempAssignment error:", error);
}

export async function removeTempAssignment(id: string): Promise<void> {
  const { error } = await supabase.from("temp_assignments").delete().eq("id", id);
  if (error) console.error("removeTempAssignment error:", error);
}
