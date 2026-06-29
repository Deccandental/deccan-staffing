export type DentistSpecialty =
  | "General Dentist"
  | "Prosthodontist"
  | "Periodontist"
  | "Endodontist";

export type EmployeeRole =
  | "Dentist"
  | "RDA"
  | "Assistant"
  | "Front Desk"
  | "Hygienist";

export interface Employee {
  id: number;
  name: string;
  role: EmployeeRole;
  specialty?: DentistSpecialty;  // only for Dentists
  color: string;
  skills: string[];
  defaultSchedule: {
    monday: boolean;
    tuesday: boolean;
    wednesday: boolean;
    thursday: boolean;
    friday: boolean;
  };
}
