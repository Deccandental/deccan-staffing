import { supabase } from "./supabase";

export type RequiredCertRole = "Dentist" | "RDA" | "Hygienist" | "Specialist" | "Assistant";
export type RequiredCertKind = "license" | "ce_hours" | "standalone" | "one_time_ce" | "total_ce_hours";
export type RequiredCertDateMode = "expiration" | "completion" | "none";

// Whether a course counts against the Board's 50% cap on non-live units.
// A live webinar counts as live; recorded or home study does not.
export type CeDelivery = "live" | "home_study";
export const DELIVERY_LABELS: Record<CeDelivery, string> = {
  live: "Live / in person",
  home_study: "Home study",
};

export type ProviderApproval = "" | "board" | "cerp" | "pace" | "other";
export const PROVIDER_APPROVAL_LABELS: Record<ProviderApproval, string> = {
  "": "Not recorded",
  board: "Board-registered provider",
  cerp: "ADA CERP",
  pace: "AGD PACE",
  other: "Other / unknown",
};

// Extra units a sedation or anaesthesia permit adds on top of the 50.
export type SedationPermit = "none" | "oral_conscious" | "moderate" | "general" | "oms";
export const PERMIT_LABELS: Record<SedationPermit, string> = {
  none: "No permit",
  oral_conscious: "Oral conscious sedation",
  moderate: "Moderate sedation",
  general: "General anaesthesia",
  oms: "Oral & maxillofacial surgery",
};
export const PERMIT_EXTRA_HOURS: Record<SedationPermit, number> = {
  none: 0, oral_conscious: 7, moderate: 15, general: 24, oms: 50,
};

// The Board's flat rules, in one place rather than scattered through the UI.
// Practice management and teaching methodology are "primarily of benefit to
// the licensee" and capped at 20% of the total; clinical subjects are not.
export type CeCategory = "clinical" | "self_benefit";
export const CATEGORY_LABELS: Record<CeCategory, string> = {
  clinical: "Clinical / patient care",
  self_benefit: "Practice management or teaching methodology",
};
export const SELF_BENEFIT_FRACTION = 0.2;

export const MAX_UNITS_PER_DAY = 8;
export const NON_LIVE_FRACTION = 0.5;

export interface RequiredCertType {
  id: string;
  title: string;
  appliesToRole: RequiredCertRole;
  kind: RequiredCertKind;
  frequencyMonths: number;
  sortOrder: number;
  dateMode: RequiredCertDateMode;
  targetHours: number | null;
  // "Up to 4 units" for BLS — a ceiling on what counts, separate from the
  // target. Null means no ceiling.
  maxCountableHours?: number | null;
  requiresInPersonExam?: boolean;
  requiresBoardProvider?: boolean;
}

function fromTypeRow(row: any): RequiredCertType {
  return {
    id: row.id, title: row.title, appliesToRole: row.applies_to_role,
    kind: row.kind, frequencyMonths: row.frequency_months, sortOrder: row.sort_order ?? 0,
    targetHours: row.target_hours ?? null,
    dateMode: row.date_mode ?? "expiration",
    maxCountableHours: row.max_countable_hours ?? null,
    requiresInPersonExam: row.requires_in_person_exam ?? false,
    requiresBoardProvider: row.requires_board_provider ?? false,
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
  // The course completion certificate. Optional, so a course can still be
  // logged straight away and the certificate attached later.
  fileUrl?: string | null;
  fileName?: string | null;
  delivery?: CeDelivery;
  provider?: string;
  providerApproval?: ProviderApproval;
  category?: CeCategory;
}

function fromCeRow(row: any): CeCourseEntry {
  return {
    id: row.id, employeeId: row.employee_id, requiredCertTypeId: row.required_cert_type_id,
    courseName: row.course_name, hours: row.hours, dateCompleted: row.date_completed,
    fileUrl: row.file_url ?? null, fileName: row.file_name ?? null,
    delivery: (row.delivery ?? "live") as CeDelivery,
    provider: row.provider ?? "",
    providerApproval: (row.provider_approval ?? "") as ProviderApproval,
    category: (row.category ?? "clinical") as CeCategory,
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
    file_url: input.fileUrl ?? null, file_name: input.fileName ?? null,
    delivery: input.delivery ?? "live",
    provider: input.provider ?? "",
    provider_approval: input.providerApproval ?? "",
    category: input.category ?? "clinical",
  });
  if (error) { console.error("addCeCourseEntry error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

/**
 * Correct a logged course after the fact.
 *
 * The CE log is the record produced for a licence renewal or an audit, so a
 * typo in the hours or a wrong date needs fixing in place rather than being
 * deleted and retyped — deleting loses the attached certificate file.
 */
export async function updateCeCourseEntry(
  id: string,
  updates: {
    courseName: string; hours: number; dateCompleted: string; requiredCertTypeId: string;
    delivery?: CeDelivery; provider?: string; providerApproval?: ProviderApproval; category?: CeCategory;
    // Left undefined when the attachment isn't changing, so editing the
    // hours on a course never silently drops the certificate already on it.
    fileUrl?: string | null; fileName?: string | null;
  }
): Promise<{ ok: boolean; error?: string }> {
  const payload: Record<string, unknown> = {
    course_name: updates.courseName,
    hours: updates.hours,
    date_completed: updates.dateCompleted,
    required_cert_type_id: updates.requiredCertTypeId,
  };
  if (updates.delivery !== undefined) payload.delivery = updates.delivery;
  if (updates.provider !== undefined) payload.provider = updates.provider;
  if (updates.providerApproval !== undefined) payload.provider_approval = updates.providerApproval;
  if (updates.category !== undefined) payload.category = updates.category;
  if (updates.fileUrl !== undefined) payload.file_url = updates.fileUrl;
  if (updates.fileName !== undefined) payload.file_name = updates.fileName;
  const { error } = await supabase.from("ce_course_entries").update(payload).eq("id", id);
  if (error) { console.error("updateCeCourseEntry error:", error); return { ok: false, error: error.message }; }
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
  // Set when the Board requires an in-person examination for this course and
  // nothing on file records one.
  needsInPersonExam?: boolean;
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
  allCerts: { title: string; expirationDate: string | null; ceHours: number | null; createdAt: string; inPersonExam?: boolean; ceDelivery?: "live" | "home_study" }[],
  ceEntries: CeCourseEntry[],
  today: string
): RequiredCertStatus[] {
  // Requirements are stored one row per role, so someone with two roles
  // (a Dentist who is also a Specialist, say) matches two rows for every
  // shared requirement — Malpractice Insurance, BLS/CPR and so on. The
  // requirement itself is the same thing, so keep only the first of each
  // title rather than listing it twice.
  const seenTitles = new Set<string>();
  const relevant = types
    .filter((t) => role.includes(t.appliesToRole))
    .filter((t) => {
      if (seenTitles.has(t.title)) return false;
      seenTitles.add(t.title);
      return true;
    });
  // When a title appears more than once, keep the record that has the latest expiration date, so a
  // blank duplicate can't hide a real, current one.
  const certsByTitle = new Map<string, (typeof allCerts)[number]>();
  for (const c of allCerts) {
    const prev = certsByTitle.get(c.title);
    if (!prev || (c.expirationDate && (!prev.expirationDate || c.expirationDate > prev.expirationDate))) certsByTitle.set(c.title, c);
  }
  // For ce_hours/total_ce_hours items, find this role's professional license to anchor the CE window.
  // More than one requirement can be of the "license" kind for a role (a newly added item such as
  // Workplace Violence Prevention, say). Taking simply the first one meant a license-kind item that
  // isn't on file yet made every CE requirement say "Add license first", even with the real license
  // current. So prefer a license-kind item that has an expiration date on file, and among those one
  // actually named like a license.
  const licenseTypes = types.filter((t) => t.kind === "license" && role.includes(t.appliesToRole));
  const licenseWithDate = licenseTypes.filter((t) => certsByTitle.get(t.title)?.expirationDate);
  const looksLikeLicense = (t: RequiredCertType) => /licens/i.test(t.title);
  const licenseType = licenseWithDate.find(looksLikeLicense) ?? licenseWithDate[0] ?? licenseTypes.find(looksLikeLicense) ?? licenseTypes[0];
  const licenseExpiration = licenseType ? certsByTitle.get(licenseType.title)?.expirationDate ?? null : null;

  return relevant.map((type) => {
    if (type.kind === "ce_hours") {
      if (!licenseExpiration) {
        return { type, expirationDate: null, totalHoursInWindow: 0, windowStart: null, windowEnd: null, satisfied: false, missingLicense: true, targetHours: type.targetHours };
      }
      const windowStart = addMonths(licenseExpiration, -type.frequencyMonths);
      const entries = ceEntries.filter((e) => e.requiredCertTypeId === type.id && e.dateCompleted >= windowStart && e.dateCompleted <= licenseExpiration);
      const loggedHours = entries.reduce((sum, e) => sum + e.hours, 0);
      // A requirement can equally be met by uploading the completion
      // certificate instead of typing the course in — Workplace Violence
      // Prevention is usually handled that way. Those hours already counted
      // toward the overall total and showed in the CE log as counting toward
      // this requirement, so ignoring them here left a requirement reading
      // "needed" while its own evidence sat in the log underneath it.
      const matchingCerts = allCerts.filter((c) => {
        if (c.title !== type.title || c.ceHours == null) return false;
        const effectiveDate = type.dateMode === "completion" && c.expirationDate
          ? addMonths(c.expirationDate, -type.frequencyMonths)
          : c.expirationDate ?? c.createdAt.slice(0, 10);
        return effectiveDate >= windowStart && effectiveDate <= licenseExpiration;
      });
      const certHours = matchingCerts.reduce((sum, c) => sum + (c.ceHours ?? 0), 0);
      // "Up to 4 units" for BLS: more can be earned, but only the ceiling
      // counts toward the renewal.
      const rawHours = loggedHours + certHours;
      const totalHours = type.maxCountableHours != null ? Math.min(rawHours, type.maxCountableHours) : rawHours;
      // A requirement the Board only accepts with an in-person examination
      // isn't met by a certificate that doesn't record one.
      const inPersonOk = !type.requiresInPersonExam || matchingCerts.some((c) => c.inPersonExam) || entries.length > 0;
      return {
        type, expirationDate: null, totalHoursInWindow: totalHours, windowStart, windowEnd: licenseExpiration,
        satisfied: (entries.length > 0 || matchingCerts.length > 0) && inPersonOk,
        missingLicense: false, targetHours: type.targetHours,
        needsInPersonExam: type.requiresInPersonExam && !inPersonOk,
      };
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
      // Window certificate credit by when the course was actually completed,
      // not by when the record happened to be typed into the app. Using
      // createdAt counted a certificate earned years ago (or years hence)
      // toward the current period purely because it was entered today, and
      // disagreed with the CE log, which uses the real date.
      const certHours = allCerts.filter((c) => {
        if (c.ceHours == null) return false;
        const certType = types.find((t) => t.title === c.title);
        const effectiveDate = certType && certType.dateMode === "completion" && c.expirationDate
          ? addMonths(c.expirationDate, -certType.frequencyMonths)
          : c.expirationDate ?? c.createdAt.slice(0, 10);
        return effectiveDate >= windowStart && effectiveDate <= licenseExpiration;
      }).reduce((sum, c) => sum + (c.ceHours ?? 0), 0);
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


// ------------------------------------------------- Board compliance checks --

export interface CeComplianceSummary {
  windowStart: string | null;
  windowEnd: string | null;
  /** 50, plus whatever a sedation or anaesthesia permit adds. */
  requiredHours: number;
  permitExtraHours: number;
  liveHours: number;
  homeStudyHours: number;
  totalHours: number;
  /** Half the requirement — the most that may come from home study. */
  nonLiveCap: number;
  overNonLiveCap: boolean;
  selfBenefitHours: number;
  selfBenefitCap: number;
  overSelfBenefitCap: boolean;
  /** Dates where more than 8 units were claimed, with the amount claimed. */
  daysOverDailyCap: { date: string; hours: number }[];
  exemptFirstRenewal: boolean;
}

/**
 * The three flat rules the Board applies on top of the course requirements:
 * a 50% ceiling on home study, a maximum of 8 units claimed in any one day,
 * and extra units for a sedation or anaesthesia permit.
 *
 * Kept apart from computeRequiredCertStatuses because these are properties of
 * the renewal period as a whole, not of any single requirement.
 */
export function computeCeCompliance(
  types: RequiredCertType[],
  role: RequiredCertRole[],
  allCerts: { title: string; expirationDate: string | null; ceHours: number | null; ceDelivery?: "live" | "home_study"; createdAt: string }[],
  ceEntries: CeCourseEntry[],
  permit: SedationPermit,
  exemptFirstRenewal: boolean,
  windowStart: string | null,
  windowEnd: string | null
): CeComplianceSummary {
  const totalType = types.find((t) => t.kind === "total_ce_hours" && role.includes(t.appliesToRole));
  const permitExtraHours = PERMIT_EXTRA_HOURS[permit] ?? 0;
  const requiredHours = (totalType?.targetHours ?? 50) + permitExtraHours;

  const inWindow = (d: string) => (windowStart && windowEnd ? d >= windowStart && d <= windowEnd : true);

  // Everything that earned credit in the window, from both sources, so the
  // live/home-study split and the daily totals agree with the CE log.
  const credits: { date: string; hours: number; delivery: "live" | "home_study"; category: CeCategory }[] = [];
  for (const e of ceEntries) {
    if (!inWindow(e.dateCompleted)) continue;
    credits.push({ date: e.dateCompleted, hours: e.hours, delivery: e.delivery ?? "live", category: e.category ?? "clinical" });
  }
  for (const c of allCerts) {
    if (c.ceHours == null || c.ceHours <= 0) continue;
    const certType = types.find((t) => t.title === c.title);
    const effectiveDate = certType && certType.dateMode === "completion" && c.expirationDate
      ? addMonths(c.expirationDate, -certType.frequencyMonths)
      : c.expirationDate ?? c.createdAt.slice(0, 10);
    if (!inWindow(effectiveDate)) continue;
    credits.push({ date: effectiveDate, hours: c.ceHours, delivery: c.ceDelivery ?? "live", category: "clinical" });
  }

  const liveHours = credits.filter((c) => c.delivery === "live").reduce((s, c) => s + c.hours, 0);
  const homeStudyHours = credits.filter((c) => c.delivery === "home_study").reduce((s, c) => s + c.hours, 0);

  const byDate = new Map<string, number>();
  for (const c of credits) byDate.set(c.date, (byDate.get(c.date) ?? 0) + c.hours);
  const daysOverDailyCap = [...byDate.entries()]
    .filter(([, hours]) => hours > MAX_UNITS_PER_DAY)
    .map(([date, hours]) => ({ date, hours }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const nonLiveCap = requiredHours * NON_LIVE_FRACTION;
  const selfBenefitHours = credits.filter((c) => c.category === "self_benefit").reduce((s, c) => s + c.hours, 0);
  const selfBenefitCap = requiredHours * SELF_BENEFIT_FRACTION;

  return {
    windowStart, windowEnd, requiredHours, permitExtraHours,
    liveHours, homeStudyHours, totalHours: liveHours + homeStudyHours,
    nonLiveCap, overNonLiveCap: homeStudyHours > nonLiveCap,
    selfBenefitHours, selfBenefitCap, overSelfBenefitCap: selfBenefitHours > selfBenefitCap,
    daysOverDailyCap, exemptFirstRenewal,
  };
}
