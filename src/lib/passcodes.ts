// Shared passcodes for gated areas of the app.
// "admin" unlocks Schedule Builder, Availability, Staff, Temp Staff, and
// Holidays & Closures together with a single code.
// "leaveManage" is a separate code that only unlocks Manage Leave.
// Calendar (/) and Leave Request (/leave) are never gated.

export type PasscodeGroup = "admin" | "leaveManage";

export const PASSCODES: Record<PasscodeGroup, string> = {
  admin: "1528",
  leaveManage: "2503",
};

export const SESSION_KEYS: Record<PasscodeGroup, string> = {
  admin: "dd_admin_unlocked",
  leaveManage: "dd_leave_manage_unlocked",
};
