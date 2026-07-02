import { Employee } from "@/types/employee";
import { supabase } from "./supabase";

export type DentistPrefs = Record<number, number[]>;

function rowToEmployee(row: any): Employee {
  // Handle default_schedule being either a string or an object
  let defaultSchedule = row.default_schedule;
  if (typeof defaultSchedule === "string") {
    try { defaultSchedule = JSON.parse(defaultSchedule); } catch { 
      defaultSchedule = { monday: true, tuesday: false, wednesday: true, thursday: true, friday: true };
    }
  }
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    specialty: row.specialty ?? undefined,
    color: row.color,
    skills: row.skills ?? [],
    email: row.email ?? "",
    defaultSchedule,
  };
}

export async function loadStaff(): Promise<Employee[]> {
  const { data, error } = await supabase.from("staff").select("*").order("id");
  if (error) { console.error("loadStaff error:", error); return []; }
  return (data ?? []).map(rowToEmployee);
}

export async function addEmployee(emp: Omit<Employee, "id">): Promise<Employee | null> {
  const { data, error } = await supabase.from("staff").insert({
    name: emp.name, role: emp.role, specialty: emp.specialty ?? null,
    color: emp.color, skills: emp.skills, email: emp.email ?? "",
    default_schedule: emp.defaultSchedule,
  }).select().single();
  if (error) { console.error("addEmployee error:", error); return null; }
  return rowToEmployee(data);
}

export async function updateEmployee(emp: Employee): Promise<void> {
  const { error } = await supabase.from("staff").update({
    name: emp.name, role: emp.role, specialty: emp.specialty ?? null,
    color: emp.color, skills: emp.skills, email: emp.email ?? "",
    default_schedule: emp.defaultSchedule,
  }).eq("id", emp.id);
  if (error) console.error("updateEmployee error:", error);
}

export async function removeEmployee(id: number): Promise<void> {
  const { error } = await supabase.from("staff").delete().eq("id", id);
  if (error) console.error("removeEmployee error:", error);
}

export async function loadPrefs(): Promise<DentistPrefs> {
  const { data, error } = await supabase.from("dentist_prefs").select("*");
  if (error) { console.error("loadPrefs error:", error); return {}; }
  const prefs: DentistPrefs = {};
  for (const row of data ?? []) { prefs[row.dentist_id] = row.assistant_ids; }
  return prefs;
}

export async function setDentistPrefs(dentistId: number, assistantIds: number[]): Promise<void> {
  const { error } = await supabase.from("dentist_prefs").upsert({ dentist_id: dentistId, assistant_ids: assistantIds });
  if (error) console.error("setDentistPrefs error:", error);
}
