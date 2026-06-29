export interface CalendarDay {
  date: string;
  day: number;
  weekday: string;
  isOpen: boolean;
  isWeekend: boolean;
  isTuesday: boolean;
  isOpenTuesday: boolean;
  tuesdayHalfDay: "AM" | "PM" | null;
  isHoliday?: boolean;
  holidayName?: string;
}

const CLOSED_WEEKDAYS = new Set([0, 6]); // Sun=0, Sat=6 only

export function generateMonth(
  year: number,
  month: number,
  openTuesdays: { date: string; halfDay: "AM" | "PM" | null }[] = [],
  holidays: { date: string; name: string }[] = []
): CalendarDay[] {
  const holidayMap: Record<string, string> = {};
  holidays.forEach((h) => { holidayMap[h.date] = h.name; });

  const openTuesdayMap: Record<string, "AM" | "PM" | null> = {};
  openTuesdays.forEach((t) => { openTuesdayMap[t.date] = t.halfDay; });

  const days: CalendarDay[] = [];
  const totalDays = new Date(year, month, 0).getDate();

  for (let day = 1; day <= totalDays; day++) {
    const date = new Date(year, month - 1, day);
    const dow = date.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isTuesday = dow === 2;
    const dateStr = date.toISOString().split("T")[0];
    const holidayName = holidayMap[dateStr];
    const isHoliday = !!holidayName;
    const isOpenTuesday = isTuesday && dateStr in openTuesdayMap;
    const tuesdayHalfDay = openTuesdayMap[dateStr] ?? null;
    const isOpen = !CLOSED_WEEKDAYS.has(dow) && !isHoliday && (!isTuesday || isOpenTuesday);

    days.push({
      date: dateStr,
      day,
      weekday: date.toLocaleDateString("en-US", { weekday: "short" }),
      isOpen,
      isWeekend,
      isTuesday,
      isOpenTuesday,
      tuesdayHalfDay,
      isHoliday,
      holidayName,
    });
  }

  return days;
}

export function formatMonthYear(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}
