import { Employee } from "@/types/employee";

export function isEmployeeAvailable(
  employee: Employee,
  weekday: keyof Employee["defaultSchedule"]
): boolean {
  return employee.defaultSchedule[weekday];
}

export function availableEmployees(
  employees: Employee[],
  role: Employee["role"],
  weekday: keyof Employee["defaultSchedule"]
): Employee[] {
  return employees.filter(
    (employee) =>
      employee.role === role &&
      isEmployeeAvailable(employee, weekday)
  );
}

export function availableAssistants(
  employees: Employee[],
  weekday: keyof Employee["defaultSchedule"]
) {
  return availableEmployees(
    employees,
    "Assistant",
    weekday
  );
}

export function availableFrontDesk(
  employees: Employee[],
  weekday: keyof Employee["defaultSchedule"]
) {
  return availableEmployees(
    employees,
    "Front Desk",
    weekday
  );
}

export function availableHygienists(
  employees: Employee[],
  weekday: keyof Employee["defaultSchedule"]
) {
  return availableEmployees(
    employees,
    "Hygienist",
    weekday
  );
}