import { Employee } from "@/types/employee";

export interface DailyRequirements {
  dentists: number;
  assistants: number;
  frontDesk: number;
  hygienists: number;
}

export function calculateRequirements(
  workingDentists: Employee[]
): DailyRequirements {
  return {
    dentists: workingDentists.length,
    assistants: workingDentists.length,
    frontDesk: 2,
    hygienists: 1,
  };
}

export function dentists(
  employees: Employee[]
) {
  return employees.filter(
    (employee) => employee.role === "Dentist"
  );
}

export function assistants(
  employees: Employee[]
) {
  return employees.filter(
    (employee) => employee.role === "Assistant"
  );
}

export function frontDesk(
  employees: Employee[]
) {
  return employees.filter(
    (employee) => employee.role === "Front Desk"
  );
}

export function hygienists(
  employees: Employee[]
) {
    return employees.filter(
      (employee) => employee.role === "Hygienist"
    );
}