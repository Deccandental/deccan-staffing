import { Employee } from "./employee";

export interface DentistAssignment {
  dentist: Employee;
  assistant: Employee | null;
}

export interface DailyAssignments {
  dentists: DentistAssignment[];

  frontDesk: Employee[];

  hygienists: Employee[];
}