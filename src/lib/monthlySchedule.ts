import { Employee } from "@/types/employee";
import { autoAssign } from "./autoAssign";
import { validateAssignments } from "./validation";

export interface DailySchedule {
  date: string;
  dentistCount: number;

  assistants: string[];
  frontDesk: string[];
  hygienists: string[];

  warnings: string[];
}

export function buildDailySchedule(
  employees: Employee[],
  date: string,
  dentistCount: number
): DailySchedule {
  const assignments = autoAssign(
    employees,
    date,
    dentistCount
  );

  const validation = validateAssignments(
    dentistCount,
    assignments
  );

  return {
    date,
    dentistCount,

    assistants: assignments.assistants.map(
      (employee) => employee.name
    ),

    frontDesk: assignments.frontDesk.map(
      (employee) => employee.name
    ),

    hygienists: assignments.hygienists.map(
      (employee) => employee.name
    ),

    warnings: validation.warnings,
  };
}