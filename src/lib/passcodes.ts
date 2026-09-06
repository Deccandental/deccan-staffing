// Shared passcodes for gated areas of the app.
// "admin" unlocks Schedule Builder, Availability, Staff, Temp Staff, and
// Holidays & Closures together with a single code.
// "leaveManage" is a separate code that only unlocks Manage Leave.
// "events" is a separate code (given to front desk) that only unlocks the
// Events page — it does not grant access to anything under "admin".
// Calendar (/) and Leave Request (/leave) are never gated.

export type PasscodeGroup = "admin" | "leaveManage" | "events";

export const PASSCODES: Record<PasscodeGroup, string> = {
  admin: "1528",
  leaveManage: "2503",
  events: "3391",
};

export const SESSION_KEYS: Record<PasscodeGroup, string> = {
  admin: "dd_admin_unlocked",
  leaveManage: "dd_leave_manage_unlocked",
  events: "dd_events_unlocked",
};
