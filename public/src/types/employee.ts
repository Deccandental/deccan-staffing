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
  specialty?: DentistSpecialty;
  color: string;
  skills: string[];
  email?: string;
  // Personal 4-digit PIN, set by admin, used to identify this staff member on
  // the self-service Leave Request page. Optional — staff without a PIN set
  // can't yet log in there.
  pin?: string;
  // Per-section access grants, matching the sidebar's locked groups. A staff
  // member's PIN only unlocks a gated area if the matching flag is true —
  // otherwise the super passcode is the only way in for that area.
  canAdmin?: boolean;
  canManageLeave?: boolean;
  canManageEvents?: boolean;
  canManageCerts?: boolean;
  canManagePayroll?: boolean;
  // Hours-based leave balances. Whole days are counted as 8 hours; partial
  // days can deduct any amount, since staff can request fewer hours than a
  // full day off.
  ptoBalanceHours?: number;
  sickBalanceHours?: number;
  // When true, this person is left out of the Payroll Dashboard entirely
  // (e.g. a practice owner who isn't paid through this system).
  excludeFromPayroll?: boolean;
  // When true, this person is inactive — hidden from every "pick who's
  // working / assign this to" list (Schedule Builder, swap menus, Events
  // invite list, PIN logins, etc.) but their existing records (leave
  // requests, certifications, past schedule assignments) still resolve
  // their name correctly, since the row itself is never deleted.
  archived?: boolean;
  defaultSchedule: {
    monday: boolean;
    tuesday: boolean;
    wednesday: boolean;
    thursday: boolean;
    friday: boolean;
  };
}
