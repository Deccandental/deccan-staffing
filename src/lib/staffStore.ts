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
  let remoteDays = row.remote_days;
  if (typeof remoteDays === "string") {
    try { remoteDays = JSON.parse(remoteDays); } catch { remoteDays = undefined; }
  }
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    specialty: row.specialty ?? undefined,
    color: row.color,
    skills: row.skills ?? [],
    email: row.email ?? "",
    pin: row.pin ?? "",
    canAdmin: row.can_admin ?? false,
    canManageLeave: row.can_manage_leave ?? false,
    canManageEvents: row.can_manage_events ?? false,
    canManageCerts: row.can_manage_certs ?? false,
    canManagePayroll: row.can_manage_payroll ?? false,
    ptoBalanceHours: row.pto_balance_hours ?? 0,
    sickBalanceHours: row.sick_balance_hours ?? 0,
    excludeFromPayroll: row.exclude_from_payroll ?? false,
    remoteDays: remoteDays ?? undefined,
    hireDate: row.hire_date ?? undefined,
    growthBonusEligible: row.growth_bonus_eligible ?? false,
    growthBonusMultiplier: row.growth_bonus_multiplier ?? 1,
    pvBonusEligible: row.pv_bonus_eligible ?? false,
    netProductionBonusPercent: row.net_production_bonus_percent ?? 30,
    hoBonusEligible: row.ho_bonus_eligible ?? false,
    exemptFromPolicySigning: row.exempt_from_policy_signing ?? false,
    exemptFromCheckin: row.exempt_from_checkin ?? false,
    employmentType: row.employment_type ?? "full_time",
    archived: row.archived ?? false,
    defaultSchedule,
  };
}

export async function loadStaff(): Promise<Employee[]> {
  // Deliberately excludes `pin` — this function is used all over the app
  // for display purposes (names, schedules, dropdowns), and PIN
  // verification now happens server-side via /api/auth/login instead of
  // comparing against a full list of PINs shipped to the browser.
  const { data, error } = await supabase.from("staff").select(
    "id, name, role, specialty, color, skills, email, can_admin, can_manage_leave, can_manage_events, can_manage_certs, can_manage_payroll, pto_balance_hours, sick_balance_hours, exclude_from_payroll, remote_days, hire_date, growth_bonus_eligible, growth_bonus_multiplier, pv_bonus_eligible, net_production_bonus_percent, ho_bonus_eligible, exempt_from_policy_signing, exempt_from_checkin, employment_type, archived, default_schedule"
  ).order("id");
  if (error) { console.error("loadStaff error:", error); return []; }
  return (data ?? []).map(rowToEmployee);
}

export async function addEmployee(emp: Omit<Employee, "id">): Promise<Employee | null> {
  const { data, error } = await supabase.from("staff").insert({
    name: emp.name, role: emp.role, specialty: emp.specialty ?? null,
    color: emp.color, skills: emp.skills, email: emp.email ?? "", pin: emp.pin || null,
    can_admin: emp.canAdmin ?? false, can_manage_leave: emp.canManageLeave ?? false, can_manage_events: emp.canManageEvents ?? false,
    can_manage_certs: emp.canManageCerts ?? false, can_manage_payroll: emp.canManagePayroll ?? false, archived: emp.archived ?? false,
    pto_balance_hours: emp.ptoBalanceHours ?? 0, sick_balance_hours: emp.sickBalanceHours ?? 0, exclude_from_payroll: emp.excludeFromPayroll ?? false,
    default_schedule: emp.defaultSchedule, remote_days: emp.remoteDays ?? null,
    hire_date: emp.hireDate || null, growth_bonus_eligible: emp.growthBonusEligible ?? false, growth_bonus_multiplier: emp.growthBonusMultiplier ?? 1, pv_bonus_eligible: emp.pvBonusEligible ?? false, net_production_bonus_percent: emp.netProductionBonusPercent ?? 30, ho_bonus_eligible: emp.hoBonusEligible ?? false, exempt_from_policy_signing: emp.exemptFromPolicySigning ?? false, exempt_from_checkin: emp.exemptFromCheckin ?? false, employment_type: emp.employmentType ?? "full_time",
  }).select().single();
  if (error) { console.error("addEmployee error:", error); return null; }
  return rowToEmployee(data);
}

export async function updateEmployee(emp: Employee): Promise<{ ok: boolean; error?: string }> {
  const payload: Record<string, unknown> = {
    name: emp.name, role: emp.role, specialty: emp.specialty ?? null,
    color: emp.color, skills: emp.skills, email: emp.email ?? "",
    can_admin: emp.canAdmin ?? false, can_manage_leave: emp.canManageLeave ?? false, can_manage_events: emp.canManageEvents ?? false,
    can_manage_certs: emp.canManageCerts ?? false, can_manage_payroll: emp.canManagePayroll ?? false, archived: emp.archived ?? false,
    pto_balance_hours: emp.ptoBalanceHours ?? 0, sick_balance_hours: emp.sickBalanceHours ?? 0, exclude_from_payroll: emp.excludeFromPayroll ?? false,
    default_schedule: emp.defaultSchedule, remote_days: emp.remoteDays ?? null,
    hire_date: emp.hireDate || null, growth_bonus_eligible: emp.growthBonusEligible ?? false, growth_bonus_multiplier: emp.growthBonusMultiplier ?? 1, pv_bonus_eligible: emp.pvBonusEligible ?? false, net_production_bonus_percent: emp.netProductionBonusPercent ?? 30, ho_bonus_eligible: emp.hoBonusEligible ?? false, exempt_from_policy_signing: emp.exemptFromPolicySigning ?? false, exempt_from_checkin: emp.exemptFromCheckin ?? false, employment_type: emp.employmentType ?? "full_time",
  };
  // pin is intentionally NOT loaded back by loadStaff() anymore (see its
  // comment), so emp.pin is only ever populated here when the admin
  // actually typed a new one on this save. Only touch the column then —
  // otherwise every routine edit (name, role, permissions, etc.) would
  // silently null out the employee's existing PIN and lock them out.
  if (emp.pin) payload.pin = emp.pin;
  const { error } = await supabase.from("staff").update(payload).eq("id", emp.id);
  if (error) { console.error("updateEmployee error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function setEmployeeArchived(id: number, archived: boolean): Promise<void> {
  const { error } = await supabase.from("staff").update({ archived }).eq("id", id);
  if (error) console.error("setEmployeeArchived error:", error);
}

// Adjusts a balance by a delta (positive to add hours back, negative to
// deduct). Reads the current value first since there's no atomic increment
// available without a dedicated Postgres function — acceptable here since
// these edits happen one at a time from a single admin screen.
export async function adjustLeaveBalance(id: number, field: "pto" | "sick", deltaHours: number): Promise<void> {
  const column = field === "pto" ? "pto_balance_hours" : "sick_balance_hours";
  const { data, error: readError } = await supabase.from("staff").select(column).eq("id", id).single();
  if (readError || !data) { console.error("adjustLeaveBalance read error:", readError); return; }
  const current = (data as any)[column] ?? 0;
  const { error } = await supabase.from("staff").update({ [column]: current + deltaHours }).eq("id", id);
  if (error) console.error("adjustLeaveBalance error:", error);
}

export async function setLeaveBalance(id: number, field: "pto" | "sick", hours: number): Promise<void> {
  const column = field === "pto" ? "pto_balance_hours" : "sick_balance_hours";
  const { error } = await supabase.from("staff").update({ [column]: hours }).eq("id", id);
  if (error) console.error("setLeaveBalance error:", error);
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

// Lets a staff member update only their own display name and email from
// their dashboard. Deliberately narrow: it touches just these two columns,
// so it can never alter permissions, PIN, bonus eligibility or pay fields —
// unlike updateEmployee(), which writes the whole record and is admin-only.
export async function updateOwnProfile(
  employeeId: number, updates: { name: string; email: string }
): Promise<{ ok: boolean; error?: string }> {
  const name = updates.name.trim();
  if (!name) return { ok: false, error: "Name can't be empty." };
  const { error } = await supabase
    .from("staff")
    .update({ name, email: updates.email.trim() })
    .eq("id", employeeId);
  if (error) { console.error("updateOwnProfile error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}
