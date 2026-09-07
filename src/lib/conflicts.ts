import { Employee } from "@/types/employee";

export interface Conflict {
  employeeId: number;
  employeeName: string;
  message: string;
}

export function findDuplicateAssignments(
  assignedEmployees: Employee[]
): Conflict[] {
  const seen = new Set<number>();
  const conflicts: Conflict[] = [];

  assignedEmployees.forEach((employee) => {
    if (seen.has(employee.id)) {
      conflicts.push({
        employeeId: employee.id,
        employeeName: employee.name,
        message: `${employee.name} has been assigned more than once.`,
      });
    } else {
      seen.add(employee.id);
    }
  });

  return conflicts;
}

export function hasConflicts(
  conflicts: Conflict[]
) {
  return conflicts.length > 0;
}