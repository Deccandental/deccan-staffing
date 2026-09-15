import { supabase } from "./supabase";

export type RequiredCertRole = "Dentist" | "RDA" | "Hygienist" | "Specialist";
export type RequiredCertKind = "license" | "ce_hours" | "standalone";
export type RequiredCertDateMode = "expiration" | "completion";

export interface RequiredCertType {
  id: string;
  title: string;
  appliesToRole: RequiredCertRole;
  kind: RequiredCertKind;
  frequencyMonths: number;
  sortOrder: number;
  dateMode: RequiredCertDateMode;
}

function fromTypeRow(row: any): RequiredCertType {
  return {
    id: row.id, title: row.title, appliesToRole: row.applies_to_role,
    kind: row.kind, frequencyMonths: row.frequency_months, sortOrder: row.sort_order ?? 0,
    dateMode: row.date_mode ?? "expiration",
  };
}

export async function loadRequiredCertTypes(): Promise<RequiredCertType[]> {
  const { data, error } = await supabase.from("required_cert_types").select("*").order("applies_to_role").order("sort_order");
  if (error) { console.error("loadRequiredCertTypes error:", error); return []; }
  return (data ?? []).map(fromTypeRow);
}

export async function createRequiredCertType(input: Omit<RequiredCertType, "id">): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("required_cert_types").insert({
    title: input.title, applies_to_role: input.appliesToRole, kind: input.kind,
    frequency_months: input.frequencyMonths, sort_order: input.sortOrder, date_mode: input.dateMode,
  });
  if (error) { console.error("createRequiredCertType error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

// Renaming here does NOT rename existing certifications/CE entries that
// reference the old title — see renameRequiredCertType for the version that
// also updates matching certification records.
export async function updateRequiredCertType(id: string, updates: Partial<Omit<RequiredCertType, "id">>): Promise<{ ok: boolean; error?: string }> {
  const payload: any = {};
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.appliesToRole !== undefined) payload.applies_to_role = updates.appliesToRole;
  if (updates.kind !== undefined) payload.kind = updates.kind;
  if (updates.frequencyMonths !== undefined) payload.frequency_months = updates.frequencyMonths;
  if (updates.sortOrder !== undefined) payload.sort_order = updates.sortOrder;
  if (updates.dateMode !== undefined) payload.date_mode = updates.dateMode;
  const { error } = await supabase.from("required_cert_types").update(payload).eq("id", id);
  if (error) { console.error("updateRequiredCertType error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

// Renames a required type AND updates every certification record that used
// the old title, so existing per-employee entries don't get orphaned —
// this is what lets you fix a misnamed title without re-adding everyone's data.
export async function renameRequiredCertType(id: string, oldTitle: string, newTitle: string): Promise<{ ok: boolean; error?: string }> {
  const { error: e1 } = await supabase.from("required_cert_types").update({ title: newTitle }).eq("id", id);
  if (e1) { console.error("renameRequiredCertType error:", e1); return { ok: false, error: e1.message }; }
  const { error: e2 } = await supabase.from("certifications").update({ title: newTitle }).eq("title", oldTitle);
  if (e2) { console.error("renameRequiredCertType (certifications) error:", e2); return { ok: false, error: e2.message }; }
  return { ok: true };
}

export async function deleteRequiredCertType(id: string): Promise<void> {
  const { error } = await supabase.from("required_cert_types").delete().eq("id", id);
  if (error) console.error("deleteRequiredCertType error:", error);
}

// ---------------- CE course entries (logged, not certificate files) ----------------

export interface CeCourseEntry {
  id: string;
  employeeId: number;
  requiredCertTypeId: string;
  courseName: string;
  hours: number;
  dateCompleted: string;
}

function fromCeRow(row: any): CeCourseEntry {
  return {
    id: row.id, employeeId: row.employee_id, requiredCertTypeId: row.required_cert_type_id,
    courseName: row.course_name, hours: row.hours, dateCompleted: row.date_completed,
  };
}

export async function loadCeCourseEntriesForEmployee(employeeId: number): Promise<CeCourseEntry[]> {
  const { data, error } = await supabase.from("ce_course_entries").select("*").eq("employee_id", employeeId).order("date_completed", { ascending: false });
  if (error) { console.error("loadCeCourseEntriesForEmployee error:", error); return []; }
  return (data ?? []).map(fromCeRow);
}

export async function loadAllCeCourseEntries(): Promise<CeCourseEntry[]> {
  const { data, error } = await supabase.from("ce_course_entries").select("*").order("date_completed", { ascending: false });
  if (error) { console.error("loadAllCeCourseEntries error:", error); return []; }
  return (data ?? []).map(fromCeRow);
}

export async function addCeCourseEntry(input: Omit<CeCourseEntry, "id">): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("ce_course_entries").insert({
    employee_id: input.employeeId, required_cert_type_id: input.requiredCertTypeId,
    course_name: input.courseName, hours: input.hours, date_completed: input.dateCompleted,
  });
  if (error) { console.error("addCeCourseEntry error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function deleteCeCourseEntry(id: string): Promise<void> {
  const { error } = await supabase.from("ce_course_entries").delete().eq("id", id);
  if (error) console.error("deleteCeCourseEntry error:", error);
}

// ---------------- Status computation ----------------

export interface RequiredCertStatus {
  type: RequiredCertType;
  // For license/standalone kinds:
  expirationDate: string | null;
  // For ce_hours kind:
  totalHoursInWindow: number;
  windowStart: string | null;
  windowEnd: string | null; // the linked license's expiration date
  satisfied: boolean; // true for license/standalone if not expired; true for ce_hours if any entry falls in the window
  missingLicense: boolean; // ce_hours only: true if the role's license has no expiration date on file yet, so the window can't be computed
}

export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1 + months, d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function computeRequiredCertStatuses(
  role: RequiredCertRole[],
  types: RequiredCertType[],
  certsByTitle: Map<string, { expirationDate: string | null }>,
  ceEntries: CeCourseEntry[],
  today: string
): RequiredCertStatus[] {
  const relevant = types.filter((t) => role.includes(t.appliesToRole));
  // For ce_hours items, find this role's license expiration to anchor the window.
  const licenseType = types.find((t) => t.kind === "license" && role.includes(t.appliesToRole));
  const licenseExpiration = licenseType ? certsByTitle.get(licenseType.title)?.expirationDate ?? null : null;

  return relevant.map((type) => {
    if (type.kind === "ce_hours") {
      if (!licenseExpiration) {
        return { type, expirationDate: null, totalHoursInWindow: 0, windowStart: null, windowEnd: null, satisfied: false, missingLicense: true };
      }
      const windowStart = addMonths(licenseExpiration, -type.frequencyMonths);
      const entries = ceEntries.filter((e) => e.requiredCertTypeId === type.id && e.dateCompleted >= windowStart && e.dateCompleted <= licenseExpiration);
      const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
      return { type, expirationDate: null, totalHoursInWindow: totalHours, windowStart, windowEnd: licenseExpiration, satisfied: entries.length > 0, missingLicense: false };
    }
    // license or standalone: driven by a matching certification record.
    const cert = certsByTitle.get(type.title);
    const expirationDate = cert?.expirationDate ?? null;
    const satisfied = !!expirationDate && expirationDate >= today;
    return { type, expirationDate, totalHoursInWindow: 0, windowStart: null, windowEnd: null, satisfied, missingLicense: false };
  });
}
