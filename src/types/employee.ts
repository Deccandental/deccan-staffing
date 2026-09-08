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

export interface WeekdaySchedule {
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
}

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
  // Recurring days this person works remotely — independent of whether the
  // office itself is open that day (e.g. "works remote every Tuesday" even
  // on Tuesdays the office is closed). Same shape as defaultSchedule.
  remoteDays?: WeekdaySchedule;
  // Hire date — used to compute the "first 5 months of employment" grace
  // period for the quarterly Growth Bonus (new hires aren't eligible yet).
  hireDate?: string;
  // Opt-in flag for the quarterly Growth Bonus pool. Off by default — the
  // owner, independent contractors (e.g. Dr. Ho, who has her own separate
  // arrangement), and temps are never part of this program.
  growthBonusEligible?: boolean;
  // Per-person point multiplier used when splitting the bonus pool by days
  // worked (e.g. Office Manager 1.2, Patient Scheduler 1.1, reduced 0.5).
  // Only meaningful when growthBonusEligible is true. Defaults to 1.
  growthBonusMultiplier?: number;
  // Separate opt-in for a PV-style bonus (a flat % of that person's own
  // income/production, tracked independently of the shared Growth Bonus
  // pool — e.g. Dr. PV, who is explicitly exempt from the Growth Bonus).
  pvBonusEligible?: boolean;
  // The flat percentage of that person's own net production/income they're
  // paid as a bonus (e.g. 30 for 30%). Only meaningful when pvBonusEligible
  // is true — defaults to 30 if not set.
  netProductionBonusPercent?: number;
  // Separate opt-in for a Dr. Ho-style bonus (a flat % of production, paid
  // the following month, tracked monthly rather than quarterly).
  hoBonusEligible?: boolean;
  // Defaults to full-time when unset. Used for things like PTO eligibility
  // timelines that only apply to full-time staff.
  employmentType?: "full_time" | "part_time";
  // When true, this person is inactive — hidden from every "pick who's
  // working / assign this to" list (Schedule Builder, swap menus, Events
  // invite list, PIN logins, etc.) but their existing records (leave
  // requests, certifications, past schedule assignments) still resolve
  // their name correctly, since the row itself is never deleted.
  archived?: boolean;
  defaultSchedule: WeekdaySchedule;
}
