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
  hygienistsRequired: number = 1,
  assistantCounts: Record<number, number> = {},
  floaterAssistantId: number | null = null
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
    // Fill from regular front desk staff first, then use Karla as a single
    // floater to cover one remaining gap if needed — same behavior as
    // before, just generalized to any required count (2, 3, ...).
    frontDesk = regularFrontDesk.slice(0, frontDeskRequired);
    const gapAfterRegular = frontDeskRequired - frontDesk.length;
    if (gapAfterRegular > 0 && karla && isAvailable(karla)) {
      frontDesk = [...frontDesk, karla];
      karlaOnFrontDesk = true;
    }
    const shortage = frontDeskRequired - frontDesk.length;
    if (shortage > 0) {
      const severity: "warning" | "error" = regularFrontDesk.length === 0 ? "error" : "warning";
      let message: string;
      if (frontDesk.length === 0) {
        message = "No front desk available — temp front desk needed.";
      } else if (regularFrontDesk.length === 0) {
        message = "All regular front desk staff out — temp front desk needed.";
      } else {
        message = `Only ${frontDesk.length} of ${frontDeskRequired} front desk available — temp front desk needed.`;
      }
      warnings.push({ severity, message });
    }
  }

  const dentists = employees.filter(
    (e) => e.role === "Dentist" && workingDentistNames.includes(e.name) && isAvailable(e)
  );

  const assignedIds = new Set<number>(frontDesk.map((e) => e.id));
  // The Floater is already committed for the day — exclude them from the
  // pool so the engine can't also auto-assign them to a dentist or hygiene.
  if (floaterAssistantId != null) assignedIds.add(floaterAssistantId);
  const allAssistants = employees.filter(
    (e) => e.skills.includes("Assistant") && isAvailable(e) && !assignedIds.has(e.id)
  );

  const totalAssistantsNeeded = dentists.reduce((sum, d) => sum + Math.max(0, assistantCounts[d.id] ?? 1), 0);
  if (allAssistants.length < totalAssistantsNeeded) {
    const shortage = totalAssistantsNeeded - allAssistants.length;
    warnings.push({
      severity: "error",
      message: `${shortage} temp assistant${shortage !== 1 ? "s" : ""} needed — only ${allAssistants.length} of ${totalAssistantsNeeded} required available.`,
    });
  }

  const drHo = dentists.find((d) => d.name.startsWith("Dr. Ho"));
  const sortedDentists = drHo ? [drHo, ...dentists.filter((d) => d.id !== drHo.id)] : dentists;
  const dentistAssignments: DentistAssignment[] = [];

  for (const dentist of sortedDentists) {
    const count = Math.max(0, assistantCounts[dentist.id] ?? 1);
    const prefIds: number[] = prefs[dentist.id] ?? [];
    const assigned: Employee[] = [];

    for (const prefId of prefIds) {
      if (assigned.length >= count) break;
      const candidate = allAssistants.find((a) => a.id === prefId && !assignedIds.has(a.id));
      if (candidate) { assigned.push(candidate); assignedIds.add(candidate.id); }
    }

    if (assigned.length < count && drHo && dentist.id === drHo.id && karla && !karlaOnFrontDesk && !assignedIds.has(karla.id)) {
      assigned.push(karla);
      assignedIds.add(karla.id);
    }

    while (assigned.length < count) {
      const fallback = allAssistants.find((a) => !assignedIds.has(a.id));
      if (!fallback) break;
      assigned.push(fallback);
      assignedIds.add(fallback.id);
    }

    if (assigned.length < count) {
      const shortage = count - assigned.length;
      if (assigned.length === 0) {
        warnings.push({ severity: "warning", message: `No assistant available for ${dentist.name} — temp needed.` });
      } else {
        warnings.push({ severity: "warning", message: `Only ${assigned.length} of ${count} assistants available for ${dentist.name} — ${shortage} temp needed.` });
      }
    }

    dentistAssignments.push({ dentist, assistant: assigned[0] ?? null, assistants: assigned });
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
