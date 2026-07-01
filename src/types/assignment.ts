import { Employee } from "./employee";

export interface DentistAssignment {
  dentist: Employee;
  /** First/primary assistant — kept for backward compatibility with existing display code. */
  assistant: Employee | null;
  /** Full list of assistants assigned to this dentist today (may be empty, or more than one). */
  assistants: Employee[];
}

export interface DailyAssignments {
  dentists: DentistAssignment[];

  frontDesk: Employee[];

  hygienists: Employee[];
}
