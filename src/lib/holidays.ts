const HOLIDAYS_KEY = "deccan-holidays-v1";

export interface Holiday {
  date: string;
  name: string;
  type: "holiday" | "closure" | "other";
}

export function loadHolidays(): Holiday[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(HOLIDAYS_KEY) ?? "[]"); }
  catch { return []; }
}

export function saveHolidays(holidays: Holiday[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(HOLIDAYS_KEY, JSON.stringify(holidays));
}

export function isHoliday(date: string): boolean {
  return loadHolidays().some((h) => h.date === date);
}

export function getHoliday(date: string): Holiday | null {
  return loadHolidays().find((h) => h.date === date) ?? null;
}

export function addHoliday(holiday: Holiday) {
  const holidays = loadHolidays().filter((h) => h.date !== holiday.date);
  holidays.push(holiday);
  saveHolidays(holidays);
}

export function removeHoliday(date: string) {
  saveHolidays(loadHolidays().filter((h) => h.date !== date));
}
