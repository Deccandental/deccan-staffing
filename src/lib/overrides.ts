const STORAGE_KEY = "deccan-overrides-v2";

export interface StaffOverride {
  employeeId: number;
  date: string;
  reason: "sick" | "pto" | "leave" | "other";
  halfDay?: "AM" | "PM" | null;
}

function load(): StaffOverride[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); }
  catch { return []; }
}

function save(overrides: StaffOverride[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

export function getOverrides(): StaffOverride[] { return load(); }

export function isUnavailable(employeeId: number, date: string): boolean {
  return load().some((o) => o.employeeId === employeeId && o.date === date && !o.halfDay);
}

export function isHalfDay(employeeId: number, date: string): StaffOverride | undefined {
  return load().find((o) => o.employeeId === employeeId && o.date === date && o.halfDay);
}

export function getOverrideForDate(employeeId: number, date: string): StaffOverride | undefined {
  return load().find((o) => o.employeeId === employeeId && o.date === date);
}

export function setUnavailable(employeeId: number, date: string, reason: StaffOverride["reason"], halfDay?: "AM" | "PM" | null) {
  const overrides = load().filter((o) => !(o.employeeId === employeeId && o.date === date));
  overrides.push({ employeeId, date, reason, halfDay: halfDay ?? null });
  save(overrides);
}

export function clearUnavailable(employeeId: number, date: string) {
  save(load().filter((o) => !(o.employeeId === employeeId && o.date === date)));
}
