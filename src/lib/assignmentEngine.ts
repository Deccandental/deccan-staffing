import { Employee } from "@/types/employee";
import { DailyAssignments, DentistAssignment } from "@/types/assignment";
import { getWeekday } from "./dateUtils";
import { isUnavailable } from "./overrides";
import { loadPrefs } from "./staffStore";

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
  date?: string
): DailyAssignmentsResult {
  const weekday = date ? getWeekday(date) : null;
  const prefs = loadPrefs();
  const warnings: AssignmentWarning[] = [];

  function isAvailable(emp: Employee): boolean {
    const worksDay = weekday ? emp.defaultSchedule[weekday] : true;
    const notOverridden = date ? !isUnavailable(emp.id, date) : true;
    return worksDay && notOverridden;
  }

  const karla = employees.find((e) => e.name.startsWith("Karla"));
  const regularFrontDesk = employees.filter((e) => e.role === "Front Desk" && isAvailable(e));

  let frontDesk: Employee[] = [];
  let karlaOnFrontDesk = false;

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

  const dentists = employees.filter(
    (e) => e.role === "Dentist" && workingDentistNames.includes(e.name) && isAvailable(e)
  );

  const assignedIds = new Set<number>(frontDesk.map((e) => e.id));
  const allAssistants = employees.filter(
    (e) => e.skills.includes("Assistant") && isAvailable(e) && !assignedIds.has(e.id)
  );

  // Warn early if there aren't enough assistants for the dentists scheduled
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
  const hygienists = employees.filter((e) => e.role === "Hygienist" && isAvailable(e)).slice(0, 1);

  if (hygienists.length === 0 && dentists.length > 0) {
    warnings.push({ severity: "warning", message: "No hygienist available." });
  }

  return { dentists: orderedAssignments, frontDesk, hygienists, warnings };
}
