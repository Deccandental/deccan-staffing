const STORAGE_KEY = "deccan-overrides-v1";

export interface StaffOverride {
  employeeId: number;
  date: string;
  reason: "sick" | "pto" | "leave" | "other";
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
  return load().some((o) => o.employeeId === employeeId && o.date === date);
}

export function setUnavailable(employeeId: number, date: string, reason: StaffOverride["reason"]) {
  const overrides = load().filter((o) => !(o.employeeId === employeeId && o.date === date));
  overrides.push({ employeeId, date, reason });
  save(overrides);
}

export function clearUnavailable(employeeId: number, date: string) {
  save(load().filter((o) => !(o.employeeId === employeeId && o.date === date)));
}
