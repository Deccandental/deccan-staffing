import { Employee } from "@/types/employee";
import { DailyAssignments, DentistAssignment } from "@/types/assignment";
import { getWeekday } from "./dateUtils";
import { StaffOverride } from "./overrides";
import { DentistPrefs } from "./staffStore";

export interface AssignmentWarning {
  severity: "warning" | "error";
  message: string;
}

export interface DailyAssignmentsResult extends DailyAssignments {
  warnings: AssignmentWarning[];
}

export function buildDailyAssignments(
  employees: Employee[],
  workingDentistNames: string[],
  date?: string,
  prefs: DentistPrefs = {},
  overrides: StaffOverride[] = [],
  isOpenTuesday: boolean = false,
  frontDeskRequired: number = 2,
  hygienistsRequired: number = 1
): DailyAssignmentsResult {
  const weekday = date ? getWeekday(date) : null;
  const warnings: AssignmentWarning[] = [];

  function isUnavailable(emp: Employee): boolean {
    if (!date) return false;
    return overrides.some((o) => o.employeeId === emp.id && o.date === date && !o.halfDay && o.reason !== "remote");
  }

  function isAvailable(emp: Employee): boolean {
    const worksDay = isOpenTuesday ? true : (weekday ? emp.defaultSchedule[weekday] : true);
    return worksDay && !isUnavailable(emp);
  }

  const karla = employees.find((e) => e.name.startsWith("Karla"));
  const regularFrontDesk = employees.filter((e) => e.role === "Front Desk" && isAvailable(e));

  let frontDesk: Employee[] = [];
  let karlaOnFrontDesk = false;

  if (frontDeskRequired === 1) {
    if (regularFrontDesk.length >= 1) {
      frontDesk = [regularFrontDesk[0]];
    } else {
      frontDesk = [];
      warnings.push({ severity: "error", message: "No front desk available — temp front desk needed." });
    }
  } else {
    if (regularFrontDesk.length >= 2) {
      frontDesk = regularFrontDesk.slice(0, 2);
    } else if (regularFrontDesk.length === 1) {
      if (karla && isAvailable(karla)) {
        frontDesk = [regularFrontDesk[0], karla];
        karlaOnFrontDesk = true;
      } else {
        frontDesk = regularFrontDesk;
        warnings.push({ severity: "warning", message: "Only 1 front desk available — temp front desk needed." });
      }
    } else {
      if (karla && isAvailable(karla)) {
        frontDesk = [karla];
        karlaOnFrontDesk = true;
        warnings.push({ severity: "error", message: "Both front desk staff out — temp front desk needed." });
      } else {
        frontDesk = [];
        warnings.push({ severity: "error", message: "No front desk available — temp front desk needed." });
      }
    }
  }

  const dentists = employees.filter(
    (e) => e.role === "Dentist" && workingDentistNames.includes(e.name) && isAvailable(e)
  );

  const assignedIds = new Set<number>(frontDesk.map((e) => e.id));
  const allAssistants = employees.filter(
    (e) => e.skills.includes("Assistant") && isAvailable(e) && !assignedIds.has(e.id)
  );

  if (allAssistants.length < dentists.length) {
    const shortage = dentists.length - allAssistants.length;
    warnings.push({
      severity: "error",
      message: `${shortage} temp assistant${shortage !== 1 ? "s" : ""} needed — only ${allAssistants.length} of ${dentists.length} required available.`,
    });
  }

  const drHo = dentists.find((d) => d.name.startsWith("Dr. Ho"));
  const sortedDentists = drHo ? [drHo, ...dentists.filter((d) => d.id !== drHo.id)] : dentists;
  const dentistAssignments: DentistAssignment[] = [];

  for (const dentist of sortedDentists) {
    const prefIds: number[] = prefs[dentist.id] ?? [];
    let assistant: Employee | null = null;

    for (const prefId of prefIds) {
      const candidate = allAssistants.find((a) => a.id === prefId && !assignedIds.has(a.id));
      if (candidate) { assistant = candidate; assignedIds.add(candidate.id); break; }
    }

    if (!assistant && drHo && dentist.id === drHo.id && karla && !karlaOnFrontDesk && !assignedIds.has(karla.id)) {
      assistant = karla;
      assignedIds.add(karla.id);
    }

    if (!assistant) {
      const fallback = allAssistants.find((a) => !assignedIds.has(a.id));
      if (fallback) { assistant = fallback; assignedIds.add(fallback.id); }
    }

    if (!assistant) {
      warnings.push({ severity: "warning", message: `No assistant available for ${dentist.name} — temp needed.` });
    }

    dentistAssignments.push({ dentist, assistant });
  }

  const orderedAssignments = dentists.map((d) => dentistAssignments.find((a) => a.dentist.id === d.id)!);

  // Hygienists — respect hygienistsRequired
  // Exclude anyone already used as front desk or as a dentist's assistant today,
  // so a dual-role staffer (e.g. has both "Assistant" and "Hygienist" skills)
  // can't be double-booked.
  const availableHygienists = employees.filter(
    (e) =>
      (e.role === "Hygienist" || e.skills.includes("Hygienist")) &&
      isAvailable(e) &&
      !assignedIds.has(e.id)
  );
  const hygienists = availableHygienists.slice(0, hygienistsRequired);
  hygienists.forEach((h) => assignedIds.add(h.id));

  if (hygienists.length < hygienistsRequired && dentists.length > 0) {
    const shortage = hygienistsRequired - hygienists.length;
    warnings.push({
      severity: "warning",
      message: `${shortage} temp hygienist${shortage !== 1 ? "s" : ""} needed — only ${hygienists.length} of ${hygienistsRequired} required available.`,
    });
  }

  return { dentists: orderedAssignments, frontDesk, hygienists, warnings };
}
