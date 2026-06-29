type Weekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday";

// Parse as local date to avoid UTC timezone shift
function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function getWeekday(date: string): Weekday {
  const dow = parseLocalDate(date).getDay();
  const map: Record<number, Weekday> = {
    1: "monday",
    2: "tuesday",
    3: "wednesday",
    4: "thursday",
    5: "friday",
  };
  return map[dow] ?? "monday";
}

export function isWeekend(date: string): boolean {
  const dow = parseLocalDate(date).getDay();
  return dow === 0 || dow === 6;
}

export function isOfficeOpen(date: string): boolean {
  const dow = parseLocalDate(date).getDay();
  // Closed: Sunday=0, Tuesday=2, Saturday=6
  return dow !== 0 && dow !== 2 && dow !== 6;
}
