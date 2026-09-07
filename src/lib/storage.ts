import { DailySchedule } from "./monthlySchedule";

const STORAGE_KEY = "deccan-staffing-v1";

export function saveSchedule(
  schedule: DailySchedule[]
) {
  if (typeof window === "undefined") return;

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(schedule)
  );
}

export function loadSchedule(): DailySchedule[] {
  if (typeof window === "undefined") return [];

  const data = localStorage.getItem(STORAGE_KEY);

  if (!data) return [];

  try {
    return JSON.parse(data) as DailySchedule[];
  } catch {
    return [];
  }
}

export function clearSchedule() {
  if (typeof window === "undefined") return;

  localStorage.removeItem(STORAGE_KEY);
}