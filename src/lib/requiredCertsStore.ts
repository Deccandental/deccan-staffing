import { supabase } from "./supabase";

export type RequiredCertRole = "Dentist" | "RDA" | "Hygienist" | "Specialist" | "Assistant";
export type RequiredCertKind = "license" | "ce_hours" | "standalone" | "one_time_ce" | "total_ce_hours";
export type RequiredCertDateMode = "expiration" | "completion" | "none";

export interface RequiredCertType {
  id: string;
  title: string;
  appliesToRole: RequiredCertRole;
  kind: RequiredCertKind;
  frequencyMonths: number;
  sortOrder: number;
  dateMode: RequiredCertDateMode;
  targetHours: number | null;
}

function fromTypeRow(row: any): RequiredCertType {
  return {
    id: row.id, title: row.title, appliesToRole: row.applies_to_role,
    kind: row.kind, frequencyMonths: row.frequency_months, sortOrder: row.sort_order ?? 0,
    targetHours: row.target_hours ?? null,
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
    frequency_months: input.frequencyMonths, sort_order: input.sortOrder, date_mode: input.dateMode, target_hours: input.targetHours,
  });
  if (error) { console.error("createRequiredCertType error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

// Creates one row per selected role, sharing the same title/kind/settings —
// this is what lets "add a required type" apply to several roles at once
// instead of repeating the whole form per role.
export async function createRequiredCertTypeForRoles(
  input: Omit<RequiredCertType, "id" | "appliesToRole">, roles: RequiredCertRole[]
): Promise<{ ok: boolean; error?: string }> {
  const rows = roles.map((role) => ({
    title: input.title, applies_to_role: role, kind: input.kind,
    frequency_months: input.frequencyMonths, sort_order: input.sortOrder, date_mode: input.dateMode, target_hours: input.targetHours,
  }));
  const { error } = await supabase.from("required_cert_types").insert(rows);
  if (error) { console.error("createRequiredCertTypeForRoles error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

// Groups the flat per-role rows into one entry per unique title, so the
// admin UI can show "Infection Control CE — Dentist, RDA, Hygienist" as a
// single row instead of three separate ones.
export interface GroupedRequiredType {
  title: string;
  kind: RequiredCertKind;
  frequencyMonths: number;
  dateMode: RequiredCertDateMode;
  targetHours: number | null;
  roles: RequiredCertRole[];
  ids: string[]; // the underlying row ids, one per role
}

export function groupRequiredTypesByTitle(types: RequiredCertType[]): GroupedRequiredType[] {
  const map = new Map<string, GroupedRequiredType>();
  for (const t of types) {
    const existing = map.get(t.title);
    if (existing) {
      existing.roles.push(t.appliesToRole);
      existing.ids.push(t.id);
    } else {
      map.set(t.title, {
        title: t.title, kind: t.kind, frequencyMonths: t.frequencyMonths,
        dateMode: t.dateMode, targetHours: t.targetHours, roles: [t.appliesToRole], ids: [t.id],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
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
  if (updates.targetHours !== undefined) payload.target_hours = updates.targetHours;
  const { error } = await supabase.from("required_cert_types").update(payload).eq("id", id);
  if (error) { console.error("updateRequiredCertType error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

// Updates settings (kind, frequency, date mode, target hours) shared across
// every role-row for a title at once — the edit action for a grouped
// requirement, since all its rows are meant to share the same settings.
export async function updateRequiredCertTypeByTitle(
  title: string, updates: Partial<Pick<RequiredCertType, "kind" | "frequencyMonths" | "dateMode" | "targetHours">>
): Promise<{ ok: boolean; error?: string }> {
  const payload: any = {};
  if (updates.kind !== undefined) payload.kind = updates.kind;
  if (updates.frequencyMonths !== undefined) payload.frequency_months = updates.frequencyMonths;
  if (updates.dateMode !== undefined) payload.date_mode = updates.dateMode;
  if (updates.targetHours !== undefined) payload.target_hours = updates.targetHours;
  const { error } = await supabase.from("required_cert_types").update(payload).eq("title", title);
  if (error) { console.error("updateRequiredCertTypeByTitle error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

// Renames every row that shares the old title (across all its roles) AND
// updates every certification record that used the old title, so existing
// per-employee entries don't get orphaned — this is what lets you fix a
// misnamed title without re-adding everyone's data.
export async function renameRequiredCertType(oldTitle: string, newTitle: string): Promise<{ ok: boolean; error?: string }> {
  const { error: e1 } = await supabase.from("required_cert_types").update({ title: newTitle }).eq("title", oldTitle);
  if (e1) { console.error("renameRequiredCertType error:", e1); return { ok: false, error: e1.message }; }
  const { error: e2 } = await supabase.from("certifications").update({ title: newTitle }).eq("title", oldTitle);
  if (e2) { console.error("renameRequiredCertType (certifications) error:", e2); return { ok: false, error: e2.message }; }
  return { ok: true };
}

// Deletes every row for a title across all its roles — this is the "make
// optional" action. Existing certifications/CE entries are left untouched;
// they just stop being tracked as a requirement.
export async function deleteRequiredCertTypesByTitle(title: string): Promise<void> {
  const { error } = await supabase.from("required_cert_types").delete().eq("title", title);
  if (error) console.error("deleteRequiredCertTypesByTitle error:", error);
}

// Adds one more role to an existing grouped requirement (creates a new row
// sharing the same title/settings) — used when checking an additional role
// box on an existing requirement.
export async function addRoleToRequiredType(group: GroupedRequiredType, role: RequiredCertRole): Promise<{ ok: boolean; error?: string }> {
  return createRequiredCertType({
    title: group.title, appliesToRole: role, kind: group.kind,
    frequencyMonths: group.frequencyMonths, sortOrder: 0, dateMode: group.dateMode, targetHours: group.targetHours,
  });
}

// Removes one role from an existing grouped requirement (deletes just that
// role's row) — used when unchecking a role box on an existing requirement.
export async function removeRoleFromRequiredType(group: GroupedRequiredType, role: RequiredCertRole, allTypes: RequiredCertType[]): Promise<void> {
  const match = allTypes.find((t) => t.title === group.title && t.appliesToRole === role);
  if (match) await deleteRequiredCertType(match.id);
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
  satisfied: boolean; // true for license/standalone if not expired; true for ce_hours if any entry falls in the window; true for total_ce_hours/one_time_ce if target reached
  missingLicense: boolean; // ce_hours/total_ce_hours only: true if the role's license has no expiration date on file yet, so the window can't be computed
  targetHours: number | null;
  // one_time_ce only: total hours ever logged for this requirement, at any
  // date. `satisfied` is driven by this, while `totalHoursInWindow` says how
  // many of those hours also fall inside the current renewal window and so
  // still earn CE credit. A course taken years ago satisfies the requirement
  // permanently but contributes nothing to the current renewal.
  everCompletedHours?: number;
}

export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1 + months, d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function computeRequiredCertStatuses(
  role: RequiredCertRole[],
  types: RequiredCertType[],
  allCerts: { title: string; expirationDate: string | null; ceHours: number | null; createdAt: string }[],
  ceEntries: CeCourseEntry[],
  today: string
): RequiredCertStatus[] {
  const relevant = types.filter((t) => role.includes(t.appliesToRole));
  const certsByTitle = new Map(allCerts.map((c) => [c.title, c]));
  // For ce_hours/total_ce_hours items, find this role's license expiration to anchor the window.
  const licenseType = types.find((t) => t.kind === "license" && role.includes(t.appliesToRole));
  const licenseExpiration = licenseType ? certsByTitle.get(licenseType.title)?.expirationDate ?? null : null;

  return relevant.map((type) => {
    if (type.kind === "ce_hours") {
      if (!licenseExpiration) {
        return { type, expirationDate: null, totalHoursInWindow: 0, windowStart: null, windowEnd: null, satisfied: false, missingLicense: true, targetHours: type.targetHours };
      }
      const windowStart = addMonths(licenseExpiration, -type.frequencyMonths);
      const entries = ceEntries.filter((e) => e.requiredCertTypeId === type.id && e.dateCompleted >= windowStart && e.dateCompleted <= licenseExpiration);
      const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
      return { type, expirationDate: null, totalHoursInWindow: totalHours, windowStart, windowEnd: licenseExpiration, satisfied: entries.length > 0, missingLicense: false, targetHours: type.targetHours };
    }
    if (type.kind === "total_ce_hours") {
      if (!licenseExpiration) {
        return { type, expirationDate: null, totalHoursInWindow: 0, windowStart: null, windowEnd: null, satisfied: false, missingLicense: true, targetHours: type.targetHours };
      }
      const windowStart = addMonths(licenseExpiration, -type.frequencyMonths);
      // Sum every logged CE course for any ce_hours-kind requirement on this
      // role, plus the optional ce_hours value on any certification record
      // (matched by when it was entered, as a proxy for completion date).
      const ceHourTypeIds = new Set(types.filter((t) => t.kind === "ce_hours" && role.includes(t.appliesToRole)).map((t) => t.id));
      const loggedHours = ceEntries.filter((e) => ceHourTypeIds.has(e.requiredCertTypeId) && e.dateCompleted >= windowStart && e.dateCompleted <= licenseExpiration).reduce((sum, e) => sum + e.hours, 0);
      const certHours = allCerts.filter((c) => c.ceHours != null && c.createdAt.slice(0, 10) >= windowStart && c.createdAt.slice(0, 10) <= licenseExpiration).reduce((sum, c) => sum + (c.ceHours ?? 0), 0);
      const totalHours = loggedHours + certHours;
      return { type, expirationDate: null, totalHoursInWindow: totalHours, windowStart, windowEnd: licenseExpiration, satisfied: type.targetHours != null && totalHours >= type.targetHours, missingLicense: false, targetHours: type.targetHours };
    }
    if (type.kind === "one_time_ce") {
      // Two separate questions for this kind, which are easy to conflate:
      //   1. Has the course ever been taken? That's the actual requirement —
      //      it never expires and never needs retaking.
      //   2. Was it taken inside the CURRENT license renewal window? Only
      //      then do its hours also count toward CE credit for this renewal.
      // Most people take this early in their career, so (1) is satisfied
      // while (2) is not — that's normal and not a problem to flag.
      const entries = ceEntries.filter((e) => e.requiredCertTypeId === type.id);
      const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
      const satisfied = type.targetHours != null && totalHours >= type.targetHours;

      // Work out the current renewal window from the role's license, so we
      // can report whether any of those hours also earn CE credit now.
      let windowStart: string | null = null;
      let windowEnd: string | null = null;
      let hoursInWindow = 0;
      if (licenseExpiration) {
        windowEnd = licenseExpiration;
        windowStart = addMonths(licenseExpiration, -(type.frequencyMonths || 24));
        hoursInWindow = entries
          .filter((e) => e.dateCompleted >= windowStart! && e.dateCompleted <= windowEnd!)
          .reduce((sum, e) => sum + e.hours, 0);
      }
      return { type, expirationDate: null, totalHoursInWindow: hoursInWindow, windowStart, windowEnd, satisfied, missingLicense: false, targetHours: type.targetHours, everCompletedHours: totalHours };
    }
    // license or standalone: driven by a matching certification record.
    const cert = certsByTitle.get(type.title);
    const expirationDate = cert?.expirationDate ?? null;
    // A cert marked "never expires" (dateMode 'none') is satisfied as long as
    // it's on file at all — no expiration date is expected or computed for it.
    const satisfied = type.dateMode === "none" ? !!cert : !!expirationDate && expirationDate >= today;
    return { type, expirationDate, totalHoursInWindow: 0, windowStart: null, windowEnd: null, satisfied, missingLicense: false, targetHours: type.targetHours };
  });
}
