export type EmployeeRole =
  | "Dentist"
  | "Assistant"
  | "Front Desk"
  | "Hygienist";

export interface Employee {
  id: number;

  name: string;

  role: EmployeeRole;

  skills: EmployeeRole[];

  active: boolean;

  color: string;

  defaultSchedule: {
    monday: boolean;
    tuesday: boolean;
    wednesday: boolean;
    thursday: boolean;
    friday: boolean;
  };
}
