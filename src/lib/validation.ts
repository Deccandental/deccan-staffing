import { Employee } from "@/types/employee";
import { AutoAssignmentResult } from "./autoAssign";

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
}

export function validateAssignments(
  dentistCount: number,
  assignments: AutoAssignmentResult
): ValidationResult {
  const warnings: string[] = [];

  if (assignments.assistants.length < dentistCount) {
    warnings.push(
      `Need ${dentistCount} assistants but only ${assignments.assistants.length} are available.`
    );
  }

  if (assignments.frontDesk.length < 2) {
    warnings.push(
      `Need 2 front desk staff but only ${assignments.frontDesk.length} are available.`
    );
  }

  if (assignments.hygienists.length < 1) {
    warnings.push(
      "No hygienist is available."
    );
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

export function employeeAlreadyAssigned(
  employee: Employee,
  assigned: Employee[]
) {
  return assigned.some(
    (assignedEmployee) => assignedEmployee.id === employee.id
  );
}