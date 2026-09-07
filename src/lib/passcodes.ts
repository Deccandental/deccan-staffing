// Access control for gated areas of the app.
//
// There is a single SUPER_PASSCODE that unlocks every gated area, for
// whoever holds it (kept as an emergency master key so the business is
// never locked out). Beyond that, access is granted per employee: each
// staff member's personal PIN (set on the Staff page) only unlocks a given
// area if the matching permission flag (canAdmin / canManageLeave /
// canManageEvents / canManageCerts / canManagePayroll) is turned on for them.
//
// "admin" covers Schedule Builder, Availability, Staff, Temp Staff, and
// Holidays & Closures together.
// "leaveManage" covers Manage Leave, and the manager view inside the
// self-service Leave Request page (StaffLoginGate).
// "events" covers the Events page.
// "certs" covers the Certifications page's manager view (CertsLoginGate).
// "payroll" covers the Payroll Dashboard.
// Calendar (/) and Leave Request (/leave) are never gated by this system —
// Leave Request instead uses each staff member's PIN via StaffLoginGate.

export type PasscodeGroup = "admin" | "leaveManage" | "events" | "payroll";

export const SUPER_PASSCODE = "2503";

export const SESSION_KEYS: Record<PasscodeGroup, string> = {
  admin: "dd_admin_unlocked",
  leaveManage: "dd_leave_manage_unlocked",
  events: "dd_events_unlocked",
  payroll: "dd_payroll_unlocked",
};

// Which Employee permission flag corresponds to each gated group.
export const PERMISSION_FIELDS: Record<PasscodeGroup, "canAdmin" | "canManageLeave" | "canManageEvents" | "canManagePayroll"> = {
  admin: "canAdmin",
  leaveManage: "canManageLeave",
  events: "canManageEvents",
  payroll: "canManagePayroll",
};
